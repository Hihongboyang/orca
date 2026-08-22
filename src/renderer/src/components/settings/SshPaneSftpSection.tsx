// SFTP profiles mount inside the SSH pane (D12) — split from SshPane.tsx to
// respect the repo line budget (no max-lines disables per AGENTS.md).
import type { SshTarget } from '../../../../shared/ssh-types'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { SftpProfilesSection } from './SftpProfilesSection'

export function SshPaneSftpSection({
  targets
}: {
  targets: SshTarget[]
}): React.JSX.Element | null {
  // Why: SFTP profiles are per-workspace mappings (D2/D12); only local
  // workspaces qualify (D10 — SSH workspaces have no local-side files).
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const workspacePath =
    activeWorktree?.path && !activeRepo?.connectionId ? activeWorktree.path : null

  if (!workspacePath) {
    return null
  }
  return <SftpProfilesSection workspacePath={workspacePath} targets={targets} />
}
