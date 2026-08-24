import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { SshCredentialKind } from '../ssh/ssh-connection-utils'

const CREDENTIAL_TIMEOUT_MS = 120_000
const pendingRequests = new Map<string, { resolve: (result: SshCredentialAnswer) => void }>()

export type SshCredentialAnswer = { value: string | null; remember: boolean }

function notifyCredentialResolved(
  getMainWindow: () => BrowserWindow | null,
  requestId: string
): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('ssh:credential-resolved', { requestId })
  }
}

export function requestCredential(
  getMainWindow: () => BrowserWindow | null,
  targetId: string,
  kind: SshCredentialKind,
  detail: string
): Promise<SshCredentialAnswer> {
  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingRequests.delete(requestId)) {
        notifyCredentialResolved(getMainWindow, requestId)
        resolve({ value: null, remember: false })
      }
    }, CREDENTIAL_TIMEOUT_MS)

    pendingRequests.set(requestId, {
      resolve: (result) => {
        clearTimeout(timer)
        resolve(result)
      }
    })

    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('ssh:credential-request', { requestId, targetId, kind, detail })
    } else {
      pendingRequests.delete(requestId)
      clearTimeout(timer)
      notifyCredentialResolved(getMainWindow, requestId)
      resolve({ value: null, remember: false })
    }
  })
}

export function registerCredentialHandler(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.removeHandler('ssh:submitCredential')
  ipcMain.handle(
    'ssh:submitCredential',
    (_event, args: { requestId: string; value: string | null; remember?: boolean }) => {
      const pending = pendingRequests.get(args.requestId)
      if (pending) {
        pendingRequests.delete(args.requestId)
        notifyCredentialResolved(getMainWindow, args.requestId)
        pending.resolve({ value: args.value, remember: args.remember === true })
      }
    }
  )
}
