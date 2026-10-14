import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

/**
 * Explicit ~/.ssh/config import: re-adopts every config host (clears
 * tombstones) and reports the synced count — extracted from SshPane.tsx to
 * respect the repo line budget.
 */
export async function importSshConfigAndReport(): Promise<number> {
  const result = await window.api.ssh.importConfig({ reAdopt: true })
  useAppStore.getState().recordSshRepoReadoptions(result.repoReadoptions)
  if (result.targets.length === 0) {
    toast('~/.ssh/config already in sync')
  } else {
    toast.success(
      translate(
        result.targets.length === 1
          ? 'auto.components.settings.SshPane.syncedServerSingular'
          : 'auto.components.settings.SshPane.syncedServerPlural',
        result.targets.length === 1 ? 'Synced {{count}} server' : 'Synced {{count}} servers',
        { count: result.targets.length }
      )
    )
  }
  return result.targets.length
}

export function reportSshImportFailure(err: unknown): void {
  toast.error(
    err instanceof Error
      ? err.message
      : translate('auto.components.settings.SshPane.f495689b82', 'Import failed')
  )
}
