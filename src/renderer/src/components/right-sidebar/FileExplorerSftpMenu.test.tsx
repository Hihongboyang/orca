import { describe, expect, it, vi } from 'vitest'
import { FileExplorerSftpMenu, type SftpRowMenu } from './FileExplorerSftpMenu'
import { FileExplorerVirtualRows } from './FileExplorerVirtualRows'
import type { TreeNode } from './file-explorer-types'
import { createFileExplorerRowProjection } from './file-explorer-row-projection'

type ReactElementLike = {
  type: unknown
  props: Record<string, unknown>
}

function visit(node: unknown, cb: (node: ReactElementLike) => void): void {
  if (node == null || typeof node === 'string' || typeof node === 'number') {
    return
  }
  if (Array.isArray(node)) {
    node.forEach((entry) => visit(entry, cb))
    return
  }
  const element = node as ReactElementLike
  cb(element)
  if (element.props?.children) {
    visit(element.props.children, cb)
  }
}

function collectTexts(node: unknown, texts: string[] = []): string[] {
  if (node == null) {
    return texts
  }
  if (typeof node === 'string') {
    texts.push(node)
    return texts
  }
  if (Array.isArray(node)) {
    node.forEach((entry) => collectTexts(entry, texts))
    return texts
  }
  const element = node as ReactElementLike
  if (element.props?.children !== undefined) {
    collectTexts(element.props.children, texts)
  }
  return texts
}

const sftpRowMenu: SftpRowMenu = {
  profiles: [
    {
      id: 'p1',
      label: 'prod',
      targetId: 'ssh-1',
      localRoot: 'C:/dev/app',
      defaultRemoteDir: '/srv/app'
    }
  ],
  targetEndpoints: { 'ssh-1': 'deploy@10.0.0.5' },
  setMenuLocalPath: vi.fn(),
  onAction: vi.fn(),
  onOpenSettings: vi.fn()
}

describe('FileExplorerSftpMenu', () => {
  it('renders the three submenus with disambiguated profile rows', () => {
    const tree = FileExplorerSftpMenu({
      isDirectory: false,
      menu: sftpRowMenu
    }) as never
    const texts = collectTexts(tree).join(' ')
    expect(texts).toContain('Upload to')
    expect(texts).toContain('Download from')
    expect(texts).toContain('Compare with remote')
    expect(texts).toContain('prod')
    expect(texts).toContain('deploy@10.0.0.5')
  })

  it('shows a disabled hint and settings shortcut when no profiles exist', () => {
    const tree = FileExplorerSftpMenu({
      isDirectory: false,
      menu: { ...sftpRowMenu, profiles: [] }
    }) as never
    const texts = collectTexts(tree).join(' ')
    expect(texts).toContain('No SFTP profiles')
    expect(texts).toContain('Add SFTP profile')

    let settingsItem: ReactElementLike | null = null
    visit(tree, (entry) => {
      if (collectTexts(entry).join(' ').includes('Add SFTP profile')) {
        settingsItem = entry
      }
    })
    ;(settingsItem!.props.onSelect as () => void)()
    expect(sftpRowMenu.onOpenSettings).toHaveBeenCalled()
  })

  it('disables compare for directory selections', () => {
    const tree = FileExplorerSftpMenu({ isDirectory: true, menu: sftpRowMenu }) as never
    let compareTrigger: ReactElementLike | null = null
    visit(tree, (entry) => {
      if (collectTexts(entry).join(' ') === 'Compare with remote') {
        compareTrigger = entry
      }
    })
    expect(compareTrigger!.props['disabled']).toBe(true)
  })
})

describe('sftpRowMenu threading through VirtualRows', () => {
  const fileNode: TreeNode = {
    path: '/repo/main.ts',
    relativePath: 'main.ts',
    name: 'main.ts',
    depth: 0,
    isDirectory: false,
    isSymlink: false
  }

  function rowProps(menu: unknown): Record<string, unknown> {
    let rowProps: Record<string, unknown> | null = null
    const element = FileExplorerVirtualRows({
      virtualizer: {
        getTotalSize: () => 26,
        getVirtualItems: () => [{ index: 0, key: fileNode.path, start: 0 }],
        measureElement: vi.fn()
      } as never,
      inlineInputIndex: -1,
      rowProjection: createFileExplorerRowProjection([fileNode]),
      inlineInput: null,
      handleInlineSubmit: vi.fn(),
      dismissInlineInput: vi.fn(),
      folderStatusByRelativePath: new Map(),
      statusByRelativePath: new Map(),
      ignoredByRelativePath: new Set(),
      expanded: new Set(),
      dirCache: {},
      selectedPaths: new Set(),
      activeFileId: null,
      flashingPath: null,
      deleteShortcutLabel: 'Del',
      onClick: vi.fn(),
      onDoubleClick: vi.fn(),
      onViewFile: vi.fn(),
      onContextMenuSelect: vi.fn(),
      onCopyPaths: vi.fn(),
      onStartNew: vi.fn(),
      onStartRename: vi.fn(),
      onDuplicate: vi.fn(),
      onAddFolderAsProject: vi.fn(),
      canAddFolderAsProject: () => false,
      onOpenInTerminal: vi.fn(),
      onRequestDelete: vi.fn(),
      onCollapseFolderSubtree: vi.fn(),
      onFindInFolder: vi.fn(),
      onMoveDrop: vi.fn(),
      onDragTargetChange: vi.fn(),
      onDragSourceChange: vi.fn(),
      onDragExpandDir: vi.fn(),
      onNativeDragTargetChange: vi.fn(),
      onNativeDragExpandDir: vi.fn(),
      dropTargetDir: null,
      dragSourcePath: null,
      nativeDropTargetDir: null,
      sftpRowMenu: menu
    } as never)
    visit(element, (entry) => {
      const typeName = (entry.type as { name?: string } | null)?.name
      if (typeName === 'FileExplorerRow') {
        rowProps = entry.props
      }
    })
    return rowProps ?? {}
  }

  it('forwards the menu to the row and stays absent for SSH workspaces', () => {
    const localRow = rowProps(sftpRowMenu)
    expect(localRow['sftpRowMenu']).toBe(sftpRowMenu)
    const sshRow = rowProps(null)
    expect(sshRow['sftpRowMenu']).toBe(null)
  })
})
