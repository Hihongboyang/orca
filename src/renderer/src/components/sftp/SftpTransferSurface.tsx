import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAppStore } from '@/store'
import { SftpTransferNotificationCard } from '../right-sidebar/SftpTransferNotificationCard'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

type HostKeyRequest = { hostKey: string; fingerprint: string }

/** Code-specific copy for operation-level failures; unknown codes show the raw message only. */
const ACTION_ERROR_COPY: Record<
  string,
  { titleKey: string; title: string; hintKey: string; hint: string }
> = {
  'profile-not-found': {
    titleKey: 'auto.components.sftp.SftpTransferSurface.e1a2b3c4d5',
    title: 'SFTP profile not found',
    hintKey: 'auto.components.sftp.SftpTransferSurface.f2b3c4d5e6',
    hint: 'The selected profile no longer exists or references a removed SSH target.'
  },
  'outside-local-root': {
    titleKey: 'auto.components.sftp.SftpTransferSurface.a3c4d5e6f7',
    title: 'Path outside the profile root',
    hintKey: 'auto.components.sftp.SftpTransferSurface.b4d5e6f7a8',
    hint: 'Pick the profile whose local root contains the selected file or folder.'
  },
  'compare-file-too-large': {
    titleKey: 'auto.components.sftp.SftpTransferSurface.c5e6f7a8b9',
    title: 'File too large to compare',
    hintKey: 'auto.components.sftp.SftpTransferSurface.d6f7a8b9c0',
    hint: 'Compare is capped at 10 MB per file — download it instead.'
  },
  'compare-binary-refused': {
    titleKey: 'auto.components.sftp.SftpTransferSurface.e7a8b9c0d1',
    title: 'Binary files cannot be compared',
    hintKey: 'auto.components.sftp.SftpTransferSurface.f8b9c0d1e2',
    hint: 'Compare supports text files only.'
  },
  'system-ssh-only-transport': {
    titleKey: 'auto.components.sftp.SftpTransferSurface.a9c0d1e2f3',
    title: 'Target needs system OpenSSH',
    hintKey: 'auto.components.sftp.SftpTransferSurface.b0d1e2f3a4',
    hint: 'GSSAPI or exotic ProxyCommand transports are not supported for SFTP.'
  },
  'host-key-rejected': {
    titleKey: 'auto.components.sftp.SftpTransferSurface.c1e2f3a4b5',
    title: 'Host key not confirmed',
    hintKey: 'auto.components.sftp.SftpTransferSurface.d2f3a4b5c6',
    hint: 'The connection was rejected because the host key was not trusted.'
  },
  'trash-unavailable': {
    titleKey: 'auto.components.sftp.SftpTransferSurface.e3a4b5c6d7',
    title: 'Recycle bin unavailable',
    hintKey: 'auto.components.sftp.SftpTransferSurface.f4b5c6d7e8',
    hint: 'Downloads that would overwrite a local file need a working trash.'
  }
}

/**
 * Global SFTP surface (D13/D5): transfer-card stack, first-use host-key
 * confirmation, and the hard-block warning with its clear-trust recovery.
 */
export function SftpTransferSurface(): React.JSX.Element | null {
  const cards = useAppStore((s) => s.sftpTransferCards)
  const updateProgress = useAppStore((s) => s.updateSftpTransferProgress)
  const dismissCard = useAppStore((s) => s.dismissSftpTransferCard)
  const failSftpTransfer = useAppStore((s) => s.failSftpTransfer)
  const actionError = useAppStore((s) => s.sftpActionError)
  const setActionError = useAppStore((s) => s.setSftpActionError)
  const [hostKeyRequest, setHostKeyRequest] = useState<HostKeyRequest | null>(null)

  useEffect(() => {
    const unsubscribeProgress = window.api.sftp.onTransferProgress((progress) => {
      updateProgress(progress)
    })
    const unsubscribeHostKey = window.api.sftp.onHostKeyRequired((request) => {
      setHostKeyRequest(request)
    })
    return () => {
      unsubscribeProgress()
      unsubscribeHostKey()
    }
  }, [updateProgress])

  // Why: first-use TOFU confirmation (D5); declining rejects the handshake.
  const answerHostKey = (accepted: boolean): void => {
    if (!hostKeyRequest) {
      return
    }
    const request = hostKeyRequest
    setHostKeyRequest(null)
    void window.api.sftp.confirmHostKey({ ...request, accepted }).catch(() => {
      // Why: a failed submit strands main's pending prompt; it self-resolves
      // via the main-side timeout as a rejection.
      failSftpTransfer(
        `hostkey:${request.hostKey}`,
        translate(
          'auto.components.sftp.SftpTransferSurface.7d83602dba',
          'Host key confirmation failed'
        )
      )
    })
  }

  const mismatchCard = cards.find(
    (card) => card.errorCode === 'host-key-mismatch' && card.errorHostKey
  )

  return (
    <>
      {cards.length > 0 ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex flex-col gap-2">
          {cards.map((card) => (
            <div key={card.transferId} className="pointer-events-auto">
              <SftpTransferNotificationCard
                card={card}
                onDismiss={() => dismissCard(card.transferId)}
              />
            </div>
          ))}
        </div>
      ) : null}

      <Dialog
        open={hostKeyRequest !== null}
        onOpenChange={(isOpen) => !isOpen && answerHostKey(false)}
      >
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ShieldAlert className="size-4" />
              {translate('auto.components.sftp.SftpTransferSurface.adc90e324c', 'Verify host key')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {translate(
                'auto.components.sftp.SftpTransferSurface.4f3f5ba9dd',
                'First connection to {{value0}}. Confirm the host key fingerprint (SHA256):',
                { value0: hostKeyRequest?.hostKey ?? '' }
              )}
            </DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
            {hostKeyRequest?.fingerprint}
          </code>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => answerHostKey(false)}>
              {translate('auto.components.sftp.SftpTransferSurface.2b03b59293', 'Reject')}
            </Button>
            <Button size="sm" onClick={() => answerHostKey(true)}>
              {translate(
                'auto.components.sftp.SftpTransferSurface.60b450e9d2',
                'Trust and continue'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mismatchCard !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen && mismatchCard) {
            dismissCard(mismatchCard.transferId)
          }
        }}
      >
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm text-red-400">
              <ShieldAlert className="size-4" />
              {translate(
                'auto.components.sftp.SftpTransferSurface.fac7035be8',
                'Host key changed — connection blocked'
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">{mismatchCard?.error}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => mismatchCard && dismissCard(mismatchCard.transferId)}
            >
              {translate('auto.components.sftp.SftpTransferSurface.bbfa773e5a', 'Close')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (mismatchCard?.errorHostKey) {
                  void window.api.sftp.clearHostTrust({ hostKey: mismatchCard.errorHostKey })
                  dismissCard(mismatchCard.transferId)
                }
              }}
            >
              {translate(
                'auto.components.sftp.SftpTransferSurface.7d3de269d0',
                'Clear trust and re-confirm'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={actionError !== null}
        onOpenChange={(isOpen) => !isOpen && setActionError(null)}
      >
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm text-red-400">
              <ShieldAlert className="size-4" />
              {translate(
                ACTION_ERROR_COPY[actionError?.code ?? '']?.titleKey ??
                  'auto.components.sftp.SftpTransferSurface.9d21f5b301',
                ACTION_ERROR_COPY[actionError?.code ?? '']?.title ?? 'SFTP action failed'
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {translate(
                ACTION_ERROR_COPY[actionError?.code ?? '']?.hintKey ??
                  'auto.components.sftp.SftpTransferSurface.4d94a7cc26',
                ACTION_ERROR_COPY[actionError?.code ?? '']?.hint ?? 'The action could not run.'
              )}
            </DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
            {actionError?.message}
          </code>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setActionError(null)}>
              {translate('auto.components.sftp.SftpTransferSurface.bbfa773e5a', 'Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
