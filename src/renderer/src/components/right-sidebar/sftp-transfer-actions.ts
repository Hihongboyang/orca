import { createBrowserUuid } from '@/lib/browser-uuid'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import { useAppStore } from '@/store'

export type SftpExplorerActionKind = 'upload' | 'download' | 'compare'

/** Why: main rejects typed failures as `sftp-error:<code>:<message>` (IpcSftpError). */
export function parseSftpIpcError(err: unknown): { code: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err)
  const match = raw.match(/sftp-error:([a-z-]+):?([\s\S]*)$/)
  if (match) {
    return { code: match[1], message: match[2] || match[1] }
  }
  return { code: '', message: raw }
}

/**
 * Click-to-card orchestration (D13/D14): opens the card under a renderer-minted
 * requestId, runs the invoke, and settles the card from its result. The card
 * adopts main's transferId from the first progress event (cancel needs it).
 */
export async function runSftpExplorerAction(options: {
  action: SftpExplorerActionKind
  profile: SftpWorkspaceProfile
  workspacePath: string
  localPath: string
  onCompareContent?: (content: string, profile: SftpWorkspaceProfile, localPath: string) => void
}): Promise<void> {
  const { action, profile, workspacePath, localPath } = options
  const store = useAppStore.getState()
  const requestId = createBrowserUuid()
  if (action !== 'compare') {
    store.beginSftpTransferCard({
      transferId: requestId,
      direction: action,
      profileLabel: profile.label
    })
  }
  try {
    if (action === 'compare') {
      const result = await window.api.sftp.compare({
        workspacePath,
        profileId: profile.id,
        localPath
      })
      options.onCompareContent?.(result.content, profile, localPath)
      return
    }
    const invoke = action === 'upload' ? window.api.sftp.upload : window.api.sftp.download
    const result = await invoke({ workspacePath, profileId: profile.id, localPath, requestId })
    useAppStore
      .getState()
      .finishSftpTransfer(
        { transferId: result.transferId, cancelled: result.cancelled, outcomes: result.outcomes },
        requestId
      )
  } catch (err) {
    const parsed = parseSftpIpcError(err)
    // Why: mismatch already drives its dedicated block dialog in the Surface —
    // raising here too would double-prompt (add-sftp-action-error-dialog D2).
    if (parsed.code !== 'host-key-mismatch') {
      useAppStore.getState().setSftpActionError(parsed)
    }
    useAppStore.getState().failSftpTransfer(requestId, parsed.message, parsed.code)
  }
}
