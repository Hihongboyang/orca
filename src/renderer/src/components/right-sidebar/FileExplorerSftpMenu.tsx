import { ArrowDownToLine, ArrowUpFromLine, GitCompareArrows, Settings2 } from 'lucide-react'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'

export type SftpExplorerAction = 'upload' | 'download' | 'compare'

export type SftpRowMenu = {
  profiles: SftpWorkspaceProfile[]
  /** targetId → "user@host" for disambiguation (D12 UI design). */
  targetEndpoints: Record<string, string>
  /** The clicked row records its path when the menu opens (menu object is shared). */
  setMenuLocalPath: (path: string) => void
  onAction: (action: SftpExplorerAction, profile: SftpWorkspaceProfile) => void
  onOpenSettings: () => void
}

function ProfileItems({
  menu,
  action
}: {
  menu: SftpRowMenu
  action: SftpExplorerAction
}): React.JSX.Element {
  if (menu.profiles.length === 0) {
    return (
      <>
        <ContextMenuItem disabled>
          {translate(
            'auto.components.right.sidebar.FileExplorerSftpMenu.812172051a',
            'No SFTP profiles'
          )}
        </ContextMenuItem>
        <ContextMenuItem onSelect={menu.onOpenSettings}>
          <Settings2 />
          {translate(
            'auto.components.right.sidebar.FileExplorerSftpMenu.64d96a2dbf',
            'Add SFTP profile…'
          )}
        </ContextMenuItem>
      </>
    )
  }
  return (
    <>
      {menu.profiles.map((profile) => (
        <ContextMenuItem key={profile.id} onSelect={() => menu.onAction(action, profile)}>
          {profile.label}
          <span className="ml-1 text-muted-foreground">
            {menu.targetEndpoints[profile.targetId] ?? ''}
          </span>
        </ContextMenuItem>
      ))}
    </>
  )
}

export function FileExplorerSftpMenu({
  isDirectory,
  menu
}: {
  isDirectory: boolean
  menu: SftpRowMenu
}): React.JSX.Element {
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ArrowUpFromLine />
          {translate('auto.components.right.sidebar.FileExplorerSftpMenu.39458b188d', 'Upload to')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          {ProfileItems({ menu, action: 'upload' })}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ArrowDownToLine />
          {translate(
            'auto.components.right.sidebar.FileExplorerSftpMenu.b12ae8baff',
            'Download from'
          )}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          {ProfileItems({ menu, action: 'download' })}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={isDirectory}>
          <GitCompareArrows />
          {translate(
            'auto.components.right.sidebar.FileExplorerSftpMenu.eb5edb47b6',
            'Compare with remote'
          )}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          {ProfileItems({ menu, action: 'compare' })}
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  )
}
