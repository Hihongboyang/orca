import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetPathMock,
  browserWindowFromWebContentsMock,
  browserWindowGetFocusedWindowMock,
  handleMock,
  showOpenDialogMock
} = vi.hoisted(() => ({
  appGetPathMock: vi.fn(),
  browserWindowFromWebContentsMock: vi.fn(),
  browserWindowGetFocusedWindowMock: vi.fn(),
  handleMock: vi.fn(),
  showOpenDialogMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock
  },
  BrowserWindow: {
    fromWebContents: browserWindowFromWebContentsMock,
    getFocusedWindow: browserWindowGetFocusedWindowMock
  },
  dialog: {
    showOpenDialog: showOpenDialogMock
  },
  ipcMain: {
    handle: handleMock
  }
}))

import { registerBackgroundImageHandlers } from './background-image'
import type { BackgroundImage } from '../../shared/background-image-settings'

describe('registerBackgroundImageHandlers', () => {
  let tempDir: string
  let userDataDir: string
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orca-background-test-'))
    userDataDir = join(tempDir, 'user-data')
    handlers.clear()
    appGetPathMock.mockReset()
    browserWindowFromWebContentsMock.mockReset()
    browserWindowGetFocusedWindowMock.mockReset()
    handleMock.mockReset()
    showOpenDialogMock.mockReset()

    appGetPathMock.mockReturnValue(userDataDir)
    browserWindowFromWebContentsMock.mockReturnValue(null)
    browserWindowGetFocusedWindowMock.mockReturnValue(null)
    handleMock.mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  function getHandler(channel: string): (event: unknown, ...args: unknown[]) => Promise<unknown> {
    registerBackgroundImageHandlers()
    const handler = handlers.get(channel)
    if (!handler) {
      throw new Error(`${channel} handler not registered`)
    }
    return handler
  }

  async function importPickedFile(name: string, bytes: Buffer): Promise<BackgroundImage> {
    const src = join(tempDir, name)
    await writeFile(src, bytes)
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [src] })
    return (await getHandler('background-image:import')({ sender: {} })) as BackgroundImage
  }

  it('registers import, read, and delete handlers', () => {
    registerBackgroundImageHandlers()
    expect([...handlers.keys()].sort()).toEqual([
      'background-image:delete',
      'background-image:import',
      'background-image:read'
    ])
  })

  it('imports a picked png and returns id/fileName/mimeType', async () => {
    const bytes = Buffer.from('png-bytes')
    const result = await importPickedFile('wallpaper.png', bytes)
    expect(result.mimeType).toBe('image/png')
    expect(result.fileName).toBe(`${result.id}.png`)
    await expect(readFile(join(userDataDir, 'backgrounds', result.fileName))).resolves.toEqual(
      bytes
    )
  })

  it('returns null when the picker is canceled', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(getHandler('background-image:import')({ sender: {} })).resolves.toBeNull()
  })

  it('rejects unsupported extensions', async () => {
    await expect(importPickedFile('vector.svg', Buffer.from('svg'))).rejects.toThrow(
      /Unsupported file/
    )
  })

  it('rejects files over the 32 MB cap', async () => {
    const src = join(tempDir, 'huge.png')
    // Sparse-extend past the cap without allocating the bytes in memory.
    const { open } = await import('node:fs/promises')
    const fh = await open(src, 'w')
    try {
      await fh.truncate(32 * 1024 * 1024 + 1)
    } finally {
      await fh.close()
    }
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [src] })
    await expect(getHandler('background-image:import')({ sender: {} })).rejects.toThrow(/too large/)
  })

  it('prunes the previous background file on replace', async () => {
    const first = await importPickedFile('first.png', Buffer.from('one'))
    const second = await importPickedFile('second.jpg', Buffer.from('two'))
    const entries = await readdir(join(userDataDir, 'backgrounds'))
    expect(entries).toEqual([second.fileName])
    await expect(stat(join(userDataDir, 'backgrounds', first.fileName))).rejects.toThrow()
  })

  it('reads the stored bytes back for a valid id/fileName pair', async () => {
    const bytes = Buffer.from('gif-bytes')
    const imported = await importPickedFile('spin.gif', bytes)
    const read = (await getHandler('background-image:read')(
      { sender: {} },
      imported.id,
      imported.fileName
    )) as ArrayBuffer
    expect(Buffer.from(read)).toEqual(bytes)
  })

  it('read returns null for a path-traversing fileName', async () => {
    const imported = await importPickedFile('ok.png', Buffer.from('ok'))
    await expect(
      getHandler('background-image:read')({ sender: {} }, imported.id, `${imported.id}.png/../../x`)
    ).resolves.toBeNull()
  })

  it('read returns null for a non-uuid id', async () => {
    await expect(
      getHandler('background-image:read')({ sender: {} }, '../../etc/passwd', 'whatever.png')
    ).resolves.toBeNull()
  })

  it('read throws on non-string arguments', async () => {
    await expect(
      getHandler('background-image:read')({ sender: {} }, 42 as never, null as never)
    ).rejects.toThrow(/Invalid background-image:read arguments/)
  })

  it('read returns null when the file is missing (self-heal contract)', async () => {
    const imported = await importPickedFile('gone.webp', Buffer.from('x'))
    await rm(join(userDataDir, 'backgrounds', imported.fileName), { force: true })
    await expect(
      getHandler('background-image:read')({ sender: {} }, imported.id, imported.fileName)
    ).resolves.toBeNull()
  })

  it('delete removes the stored file', async () => {
    const imported = await importPickedFile('temp.png', Buffer.from('t'))
    await getHandler('background-image:delete')({ sender: {} }, imported.id, imported.fileName)
    await expect(stat(join(userDataDir, 'backgrounds', imported.fileName))).rejects.toThrow()
  })

  it('delete ignores traversal-shaped inputs without throwing', async () => {
    await expect(
      getHandler('background-image:delete')({ sender: {} }, 'not-a-uuid', 'x.png')
    ).resolves.toBeUndefined()
  })
})
