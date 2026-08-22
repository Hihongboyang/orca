import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

/**
 * Clears a target's remembered credentials (both kinds — users think of "the
 * remembered credential" for a host, D3) and toasts the outcome.
 */
export async function clearRememberedCredentialForTarget(targetId: string): Promise<void> {
  try {
    await window.api.ssh.clearRememberedCredential({ targetId })
    toast.success(
      translate('auto.components.settings.SshPane.fd64ae9b45', 'Remembered credential cleared')
    )
  } catch (err) {
    toast.error(
      err instanceof Error
        ? err.message
        : translate(
            'auto.components.settings.SshPane.3cf6b9959a',
            'Failed to clear remembered credential'
          )
    )
  }
}
