import { Suspense, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { readRuntimeFileContent } from '@/runtime/runtime-file-read-client'
import { detectLanguage } from '@/lib/language-detect'
import { translate } from '@/i18n/i18n'

const DiffViewer = lazy(() => import('./DiffViewer'))

type LocalReadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; content: string }

/**
 * Read-only local ↔ remote compare (D8/D15): renders the mirrored remote
 * content against the local file through the shared DiffViewer pattern.
 */
export function SftpCompareDialog({
  open,
  localPath,
  remoteContent,
  profileLabel,
  onClose
}: {
  open: boolean
  localPath: string
  remoteContent: string
  profileLabel: string
  onClose: () => void
}): React.JSX.Element {
  const [localState, setLocalState] = useState<LocalReadState>({ kind: 'loading' })

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
                value0: profileLabel
              }
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.editor.SftpCompareDialog.6eb78fac8b',
              'Local (left) vs remote (right), read-only — {{value0}}',
              { value0: localPath }
            )}
          </DialogDescription>
        </DialogHeader>
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
                  modelKey={`sftp-compare:${localPath}`}
                  originalModelKey={`sftp-compare-local:${localPath}`}
                  modifiedModelKey={`sftp-compare-remote:${localPath}`}
                  originalContent={localState.content}
                  modifiedContent={remoteContent}
                  language={detectLanguage(localPath)}
                  filePath={localPath}
                  relativePath={localPath.split(/[\\/]/).pop() ?? localPath}
                  sideBySide
                />
              </div>
            </Suspense>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
