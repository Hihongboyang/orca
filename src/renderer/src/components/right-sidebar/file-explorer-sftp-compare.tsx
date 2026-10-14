import { useRef, useState } from 'react'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import { SftpCompareDialog } from '../editor/SftpCompareDialog'
import type { SftpRowMenu } from './FileExplorerSftpMenu'
import { useSftpExplorerMenu } from './use-sftp-explorer-menu'

type SftpCompareTarget = {
  sessionKey: number
  localPath: string
  remoteContent: string
  profile: SftpWorkspaceProfile
  workspacePath: string
}

/** The FileExplorer's SFTP row menu plus the compare dialog its "Compare" entry opens. */
export function useFileExplorerSftpCompare(args: {
  workspacePath: string | null
  isSshWorkspace: boolean
}): { sftpRowMenu: SftpRowMenu | null; compareDialog: React.JSX.Element | null } {
  const { workspacePath, isSshWorkspace } = args
  // Why: sessionKey rotates the compare dialog's Monaco model keys so every
  // open renders fresh content instead of reusing kept-alive models (D1).
  const nextSessionRef = useRef(0)
  const [compare, setCompare] = useState<SftpCompareTarget | null>(null)
  const sftpRowMenu = useSftpExplorerMenu({
    workspacePath,
    isSshWorkspace,
    onCompare: ({ content, localPath, profile, workspacePath }) =>
      setCompare({
        sessionKey: ++nextSessionRef.current,
        localPath,
        remoteContent: content,
        profile,
        workspacePath
      })
  })
  const compareDialog = compare ? (
    <SftpCompareDialog
      open
      sessionKey={compare.sessionKey}
      localPath={compare.localPath}
      remoteContent={compare.remoteContent}
      profile={compare.profile}
      workspacePath={compare.workspacePath}
      onClose={() => setCompare(null)}
    />
  ) : null
  return { sftpRowMenu, compareDialog }
}
