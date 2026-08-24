import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname, join, normalize, sep } from 'node:path'
import { z } from 'zod'
import type { BackgroundImage } from '../../shared/types'

// Why: wallpapers only — same allowlist idea as pets minus svg/apng (vector and
// animated-png wallpapers are not a thing; a shorter list is easier to reason about).
const IMAGE_FORMATS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

// 32 MB — bounded so a multi-GB file can't be decoded into renderer/GPU memory; 8K PNGs fit comfortably.
const MAX_BYTES = 32 * 1024 * 1024

function getBackgroundsDir(): string {
  return join(app.getPath('userData'), 'backgrounds')
}

function isSafeId(id: string): boolean {
  // UUIDs only — canonical path-traversal gate; storage ids are always main-generated.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

function resolveBackgroundFile(id: string, fileName: string): string | null {
  if (!isSafeId(id)) {
    return null
  }
  const safeName = basename(fileName)
  // Filename must start with the id so the prefix check backstops the regex.
  if (!safeName.startsWith(`${id}.`)) {
    return null
  }
  const root = normalize(getBackgroundsDir())
  const filePath = normalize(join(root, safeName))
  if (!filePath.startsWith(root + sep)) {
    return null
  }
  return filePath
}

// Why: renderer IPC inputs are untrusted — validate shape here; resolveBackgroundFile still gates the actual path.
const BackgroundFileRequestSchema = z.object({
  id: z.string(),
  fileName: z.string()
})

/** Remove every stored background except `keepFileName`, so replace/crash-replace can never accumulate orphans. */
async function pruneSiblingBackgrounds(keepFileName: string): Promise<void> {
  try {
    const entries = await readdir(getBackgroundsDir())
    await Promise.all(
      entries
        .filter((name) => name !== keepFileName)
        .map((name) => rm(join(getBackgroundsDir(), name), { force: true }))
    )
  } catch {
    // Missing dir or transient failure is fine — the next import prunes again.
  }
}

export function registerBackgroundImageHandlers(): void {
  ipcMain.handle('background-image:import', async (event): Promise<BackgroundImage | null> => {
    const senderWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Pick a background image',
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    }
    const result = senderWindow
      ? await dialog.showOpenDialog(senderWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const src = result.filePaths[0]
    const ext = extname(src).toLowerCase()
    const mimeType = IMAGE_FORMATS[ext]
    if (!mimeType) {
      throw new Error('Unsupported file. Pick a PNG, JPG, GIF, or WebP.')
    }
    let srcStat: Awaited<ReturnType<typeof stat>>
    try {
      srcStat = await stat(src)
    } catch {
      throw new Error('Could not read the selected file.')
    }
    if (!srcStat.isFile()) {
      throw new Error('Selected path is not a file')
    }
    if (srcStat.size > MAX_BYTES) {
      throw new Error(
        `File is too large (${(srcStat.size / (1024 * 1024)).toFixed(1)} MB). Max is ${MAX_BYTES / (1024 * 1024)} MB.`
      )
    }

    const dir = getBackgroundsDir()
    await mkdir(dir, { recursive: true })
    const id = randomUUID()
    // Why: keep the original extension so read can rebuild the Blob MIME without a separate lookup.
    const fileName = `${id}${ext}`
    const dest = join(dir, fileName)
    try {
      await copyFile(src, dest)
    } catch {
      await rm(dest, { force: true }).catch(() => {})
      throw new Error('Could not save the background image.')
    }
    await pruneSiblingBackgrounds(fileName)
    return { id, fileName, mimeType }
  })

  ipcMain.handle(
    'background-image:read',
    async (_event, id: string, fileName: string): Promise<ArrayBuffer | null> => {
      let parsed: z.infer<typeof BackgroundFileRequestSchema>
      try {
        parsed = BackgroundFileRequestSchema.parse({ id, fileName })
      } catch {
        throw new Error('Invalid background-image:read arguments')
      }
      const filePath = resolveBackgroundFile(parsed.id, parsed.fileName)
      if (!filePath) {
        return null
      }
      try {
        const buf = await readFile(filePath)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      } catch (error) {
        console.warn('[background-image] background-image:read failed', error)
        return null
      }
    }
  )

  ipcMain.handle(
    'background-image:delete',
    async (_event, id: string, fileName: string): Promise<void> => {
      let parsed: z.infer<typeof BackgroundFileRequestSchema>
      try {
        parsed = BackgroundFileRequestSchema.parse({ id, fileName })
      } catch {
        throw new Error('Invalid background-image:delete arguments')
      }
      const filePath = resolveBackgroundFile(parsed.id, parsed.fileName)
      if (!filePath) {
        return
      }
      try {
        await rm(filePath, { force: true })
      } catch (error) {
        console.warn('[background-image] background-image:delete failed', error)
      }
    }
  )
}
