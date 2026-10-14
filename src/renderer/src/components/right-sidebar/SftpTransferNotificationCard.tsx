import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from 'lucide-react'
import type { SftpTransferCard } from '../../store/slices/sftp'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'

const AUTO_DISMISS_SUCCESS_MS = 4000
/**
 * Persistent transfer card (D13): lives in the toast overlay area while a
 * transfer is in flight; done cards show the summary and dismiss on demand.
 */
export function SftpTransferNotificationCard({
  card,
  onDismiss
}: {
  card: SftpTransferCard
  onDismiss: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const directionLabel =
    card.direction === 'upload'
      ? translate(
          'auto.components.right.sidebar.SftpTransferNotificationCard.39458b188d',
          'Upload to'
        )
      : translate(
          'auto.components.right.sidebar.SftpTransferNotificationCard.b12ae8baff',
          'Download from'
        )
  const inFlight = card.phase !== 'done'
  const succeeded = card.outcomes?.filter((outcome) => outcome.ok).length ?? 0
  const failed = card.outcomes?.filter((outcome) => !outcome.ok) ?? []
  const cleanSuccess =
    card.phase === 'done' &&
    !card.error &&
    !card.cancelled &&
    card.outcomes !== null &&
    failed.length === 0

  // Why: wall-clock dismissal lives here (not the store) so hover can pause it (D6).
  useEffect(() => {
    if (!cleanSuccess || hovered) {
      return
    }
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_SUCCESS_MS)
    return () => window.clearTimeout(timer)
  }, [cleanSuccess, hovered, onDismiss])

  return (
    <div
      data-sftp-transfer-card=""
      className="w-80 space-y-1.5 rounded-lg border border-border/60 bg-card/95 p-3 shadow-lg"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div className="flex items-center gap-2">
        {inFlight ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : card.direction === 'upload' ? (
          <ArrowUpFromLine className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ArrowDownToLine className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {directionLabel} {card.profileLabel}
        </span>
        {inFlight ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void window.api.sftp.cancelTransfer({ transferId: card.transferId })}
          >
            {translate(
              'auto.components.right.sidebar.SftpTransferNotificationCard.77dfd2135f',
              'Cancel'
            )}
          </Button>
        ) : (
          <Button variant="ghost" size="xs" onClick={onDismiss}>
            {translate(
              'auto.components.right.sidebar.SftpTransferNotificationCard.70afe9eff3',
              'Dismiss'
            )}
          </Button>
        )}
      </div>

      {card.phase === 'connecting' ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.SftpTransferNotificationCard.fd3e796994',
            'Connecting…'
          )}
        </p>
      ) : null}
      {card.phase === 'transferring' ? (
        <p className="truncate text-[11px] text-muted-foreground">
          {card.filesDone}/{card.filesTotal}{' '}
          {translate(
            'auto.components.right.sidebar.SftpTransferNotificationCard.a1f13b3bc2',
            'files'
          )}{' '}
          · {card.currentPath}
        </p>
      ) : null}
      {card.phase === 'done' && card.error ? (
        <p className="break-all text-[11px] text-red-400">{card.error}</p>
      ) : null}
      {card.phase === 'done' && !card.error && card.outcomes ? (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">
            {card.cancelled
              ? translate(
                  'auto.components.right.sidebar.SftpTransferNotificationCard.d21dc457f2',
                  'Cancelled —'
                )
              : ''}
            {succeeded}{' '}
            {translate(
              'auto.components.right.sidebar.SftpTransferNotificationCard.88c2e0b30e',
              'succeeded'
            )}
            {failed.length > 0
              ? ` / ${failed.length} ${translate('auto.components.right.sidebar.SftpTransferNotificationCard.5f5f8758f5', 'failed')}`
              : ''}
          </p>
          {failed.length > 0 ? (
            <ul className="worktree-sidebar-scrollbar max-h-24 space-y-0.5 overflow-y-auto">
              {failed.map((outcome) => (
                <li
                  key={outcome.path}
                  className="truncate text-[11px] text-red-400"
                  title={outcome.error}
                >
                  {outcome.path} — {outcome.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
