import { useEffect, useMemo, useRef, useState } from 'react'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import { useAppStore } from '@/store'
import { runSftpExplorerAction, type SftpExplorerActionKind } from './sftp-transfer-actions'
import type { SftpRowMenu } from './FileExplorerSftpMenu'

export type OpenSftpCompare = (options: {
  content: string
  localPath: string
  profile: SftpWorkspaceProfile
  workspacePath: string
}) => void

/**
 * SFTP context-menu model for the file explorer (D10/D12): null on SSH remote
 * workspaces; otherwise the workspace's profiles with target disambiguation
 * and click-to-card transfer orchestration (D13/D14). Only one context menu is
 * open at a time, so the clicked node's path is captured per menu-open.
 */
export function useSftpExplorerMenu(options: {
  workspacePath: string | null
  isSshWorkspace: boolean
  onCompare: OpenSftpCompare
}): SftpRowMenu | null {
  const { workspacePath, isSshWorkspace, onCompare } = options
  const [targetEndpoints, setTargetEndpoints] = useState<Record<string, string>>({})
  const setSftpProfiles = useAppStore((s) => s.setSftpProfiles)
  // Why: select the stable map, then index — a keyed lookup in the selector
  // would mint a fresh [] on every unrelated store write (no-fresh-selector).
  const profilesByWorkspace = useAppStore((s) => s.sftpProfilesByWorkspace)
  // Why: ContextMenu items fire after render; the clicked row records its path
  // when the menu opens (the menu object is shared across rows).
  const activeMenuPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!workspacePath || isSshWorkspace) {
      return
    }
    let canceled = false
    void window.api.sftp.listProfiles({ workspacePath }).then((loaded) => {
      if (!canceled) {
        setSftpProfiles(workspacePath, loaded)
      }
    })
    void window.api.ssh.listTargets().then((targets: SshTarget[]) => {
      if (!canceled) {
        const endpoints: Record<string, string> = {}
        for (const target of targets) {
          endpoints[target.id] = target.username ? `${target.username}@${target.host}` : target.host
        }
        setTargetEndpoints(endpoints)
      }
    })
    const unsubscribe = window.api.sftp.onProfilesChanged((next) => {
      if (!canceled && workspacePath) {
        setSftpProfiles(workspacePath, next)
      }
    })
    return () => {
      canceled = true
      unsubscribe()
    }
  }, [workspacePath, isSshWorkspace, setSftpProfiles])

  return useMemo<SftpRowMenu | null>(() => {
    if (!workspacePath || isSshWorkspace) {
      return null
    }
    return {
      profiles: profilesByWorkspace[workspacePath] ?? [],
      targetEndpoints,
      setMenuLocalPath: (path) => {
        activeMenuPathRef.current = path
      },
      onAction: (action: SftpExplorerActionKind, profile: SftpWorkspaceProfile) => {
        const localPath = activeMenuPathRef.current
        if (!localPath) {
          return
        }
        void runSftpExplorerAction({
          action,
          profile,
          workspacePath,
          localPath,
          onCompareContent: (content, comparedProfile, comparedLocalPath) =>
            onCompare({
              content,
              localPath: comparedLocalPath,
              profile: comparedProfile,
              workspacePath
            })
        })
      },
      onOpenSettings: () => {
        useAppStore.getState().openSettingsTarget({ pane: 'ssh', repoId: null })
      }
    }
  }, [workspacePath, isSshWorkspace, profilesByWorkspace, targetEndpoints, onCompare])
}
