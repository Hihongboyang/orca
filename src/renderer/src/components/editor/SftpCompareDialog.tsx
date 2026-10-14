import { Suspense, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, CornerDownRight, ListChecks } from 'lucide-react'
import type { editor } from 'monaco-editor'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { readRuntimeFileContent } from '@/runtime/runtime-file-read-client'
import { detectLanguage } from '@/lib/language-detect'
import { monaco } from '@/lib/monaco-setup'
import { parseSftpIpcError } from '../right-sidebar/sftp-transfer-actions'
import { translate } from '@/i18n/i18n'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import {
  disposeUnattachedMonacoModelsByPathPrefixes,
  getDiffViewerMonacoModelPathPrefixes
} from './diff-monaco-model-disposal'
import {
  applyAllSftpLineChanges,
  applySftpLineChange,
  type SftpLineChange
} from './sftp-compare-apply-change'

const DiffViewer = lazy(() => import('./DiffViewer'))

type LocalReadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; content: string }

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

/** Distance from `line` to a (possibly empty) side range; 0 when inside. */
function distanceToChangeRange(line: number, start: number, end: number): number {
  const lo = start
  const hi = Math.max(end, start - 1)
  return line < lo ? lo - line : line > hi ? line - hi : 0
}

/**
 * Local ↔ remote compare (D8/D15) with save-back and chunk apply
 * (add-sftp-compare-edit): remote pane editable, local pane a read-only
 * reference; per-session model keys keep every open fresh (D1).
 */
export function SftpCompareDialog({
  open,
  sessionKey,
  localPath,
  remoteContent,
  profile,
  workspacePath,
  onClose
}: {
  open: boolean
  /** Per-open nonce: rotates DiffViewer model keys so stale models are never reused. */
  sessionKey: number
  localPath: string
  remoteContent: string
  profile: SftpWorkspaceProfile
  workspacePath: string
  onClose: () => void
}): React.JSX.Element {
  const [localState, setLocalState] = useState<LocalReadState>({ kind: 'loading' })
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const latestRemoteRef = useRef(remoteContent)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const modelKey = `sftp-compare:${sessionKey}:${localPath}`

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    setLocalState({ kind: 'loading' })
    void readRuntimeFileContent({
      target: { kind: 'local' },
      filePath: localPath
    })
      .then((result) => {
        if (!cancelled) {
          setLocalState({ kind: 'ready', content: result.content })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLocalState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, localPath])

  // Why: fresh session ⇒ fresh draft; the pristine remote content seeds the buffer.
  useEffect(() => {
    latestRemoteRef.current = remoteContent
    setDirty(false)
    setSaveState({ kind: 'idle' })
  }, [sessionKey, remoteContent])

  // Why: release this session's Monaco models once the viewer has detached
  // (same deferred-dispose hygiene as the large-diff fallback).
  useEffect(() => {
    const prefixes = getDiffViewerMonacoModelPathPrefixes(modelKey)
    return () => {
      window.setTimeout(() => {
        disposeUnattachedMonacoModelsByPathPrefixes(monaco, [
          prefixes.originalModelPathPrefix,
          prefixes.modifiedModelPathPrefix
        ])
      }, 0)
    }
  }, [modelKey])

  const handleSave = (content: string): void => {
    latestRemoteRef.current = content
    setSaveState({ kind: 'saving' })
    void window.api.sftp
      .saveRemote({ workspacePath, profileId: profile.id, localPath, content })
      .then(() => {
        setDirty(false)
        setSaveState({ kind: 'saved' })
      })
      .catch((error: unknown) => {
        setSaveState({ kind: 'error', message: parseSftpIpcError(error).message })
      })
  }

  const applyHunkAtCursor = (): void => {
    const diffEditor = diffEditorRef.current
    const changes = diffEditor?.getLineChanges()
    const models = diffEditor?.getModel()
    if (!diffEditor || !changes || changes.length === 0 || !models?.original || !models.modified) {
      return
    }
    const modifiedEditor = diffEditor.getModifiedEditor()
    const originalEditor = diffEditor.getOriginalEditor()
    const onModifiedSide = modifiedEditor.hasTextFocus() || !originalEditor.hasTextFocus()
    const position = (onModifiedSide ? modifiedEditor : originalEditor).getPosition()
    const cursorLine = position?.lineNumber ?? 1
    let nearest: SftpLineChange | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const change of changes) {
      const distance = onModifiedSide
        ? distanceToChangeRange(
            cursorLine,
            change.modifiedStartLineNumber,
            change.modifiedEndLineNumber
          )
        : distanceToChangeRange(
            cursorLine,
            change.originalStartLineNumber,
            change.originalEndLineNumber
          )
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = change
      }
    }
    if (nearest) {
      applySftpLineChange(models.modified, models.original, nearest)
      setDirty(true)
      setSaveState({ kind: 'idle' })
    }
  }

  const applyAllHunks = (): void => {
    const diffEditor = diffEditorRef.current
    const changes = diffEditor?.getLineChanges()
    const models = diffEditor?.getModel()
    if (!changes || changes.length === 0 || !models?.original || !models.modified) {
      return
    }
    applyAllSftpLineChanges(models.modified, models.original, changes)
    setDirty(true)
    setSaveState({ kind: 'idle' })
  }

  const hunkCursorRef = useRef(0)
  /** Standalone Monaco exposes no next/previous-diff actions — walk the live
   * line changes ourselves and center the modified pane on the hunk. */
  const navigateHunks = (direction: 1 | -1): void => {
    const diffEditor = diffEditorRef.current
    const changes = diffEditor?.getLineChanges()
    if (!diffEditor || !changes || changes.length === 0) {
      return
    }
    hunkCursorRef.current = Math.min(
      Math.max(hunkCursorRef.current + direction, 0),
      changes.length - 1
    )
    const change = changes[hunkCursorRef.current]
    const line = Math.max(1, change.modifiedStartLineNumber)
    const modifiedEditor = diffEditor.getModifiedEditor()
    modifiedEditor.setPosition({ lineNumber: line, column: 1 })
    modifiedEditor.revealLineInCenter(line)
  }

  const saving = saveState.kind === 'saving'

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      {/* Why: DiffViewer needs a flex column with a hard height (same sizing
          contract as ExternalFileChangeCompareDialog) or it collapses to a
          sliver inside the default auto-height DialogContent. */}
      <DialogContent className="flex h-[80vh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="px-6 pt-5">
          <DialogTitle className="text-sm">
            {translate(
              'auto.components.editor.SftpCompareDialog.8173ee67c1',
              'SFTP compare — {{value0}}',
              {
                value0: profile.label
              }
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.editor.SftpCompareDialog.5bd42baa19',
              'Local (left, read-only) vs remote (right, editable) — {{value0}}',
              { value0: localPath }
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2">
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigateHunks(-1)}>
            <ChevronUp className="size-3.5" />
            {translate('auto.components.editor.SftpCompareDialog.27c9c39b53', 'Previous change')}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigateHunks(1)}>
            <ChevronDown className="size-3.5" />
            {translate('auto.components.editor.SftpCompareDialog.d4277960cd', 'Next change')}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={applyHunkAtCursor}>
            <CornerDownRight className="size-3.5" />
            {translate('auto.components.editor.SftpCompareDialog.1fbb1f9d51', 'Apply change')}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={applyAllHunks}>
            <ListChecks className="size-3.5" />
            {translate('auto.components.editor.SftpCompareDialog.9c40c81d88', 'Apply all')}
          </Button>
          <div className="flex-1" />
          {dirty ? (
            <span
              data-sftp-compare-dirty=""
              className="size-2 rounded-full bg-amber-500"
              title={translate(
                'auto.components.editor.SftpCompareDialog.0f21f7d3d6',
                'Unsaved changes'
              )}
            />
          ) : null}
          {saveState.kind === 'error' ? (
            <p className="max-w-56 truncate text-[11px] text-red-400" title={saveState.message}>
              {saveState.message}
            </p>
          ) : null}
          {saveState.kind === 'saving' ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          {saveState.kind === 'saved' ? (
            <span className="text-[11px] text-muted-foreground">
              {translate('auto.components.editor.SftpCompareDialog.756dbb7b4c', 'Saved')}
            </span>
          ) : null}
          <Button
            size="sm"
            className="h-7"
            disabled={saving}
            onClick={() => handleSave(latestRemoteRef.current)}
          >
            {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            {translate('auto.components.editor.SftpCompareDialog.4e190b4182', 'Save')}
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          {localState.kind === 'loading' ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : localState.kind === 'error' ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-red-400">
              {localState.message}
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {translate(
                    'auto.components.editor.SftpCompareDialog.9d4f8f1c1a',
                    'Loading comparison...'
                  )}
                </div>
              }
            >
              <div className="flex h-full min-h-0 flex-col">
                <DiffViewer
                  modelKey={modelKey}
                  originalModelKey={`${modelKey}:local`}
                  modifiedModelKey={`${modelKey}:remote`}
                  originalContent={localState.content}
                  modifiedContent={remoteContent}
                  language={detectLanguage(localPath)}
                  filePath={localPath}
                  relativePath={localPath.split(/[\\/]/).pop() ?? localPath}
                  sideBySide
                  editable
                  onDiffEditorReady={(ready) => {
                    diffEditorRef.current = ready
                  }}
                  onContentChange={(content) => {
                    latestRemoteRef.current = content
                    setDirty(true)
                    setSaveState({ kind: 'idle' })
                  }}
                  onSave={handleSave}
                />
              </div>
            </Suspense>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
