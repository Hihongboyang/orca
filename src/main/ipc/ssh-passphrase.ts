import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { SSH_CREDENTIAL_TIMEOUT_MS, type SshCredentialKind } from '../ssh/ssh-connection-utils'

const pendingRequests = new Map<string, { resolve: (value: string | null, remember?: boolean) => void }>()

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
  detail: string,
  echo?: boolean,
  signal?: AbortSignal
): Promise<SshCredentialAnswer> {
  const requestId = randomUUID()
  const { promise, resolve } = Promise.withResolvers<SshCredentialAnswer>()
  let timer: ReturnType<typeof setTimeout>
  const finish = (value: string | null, remember = false): void => {
    if (!pendingRequests.delete(requestId)) {
      return
    }
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    notifyCredentialResolved(getMainWindow, requestId)
    resolve({ value, remember })
  }
  const onAbort = (): void => finish(null)
  timer = setTimeout(() => finish(null), SSH_CREDENTIAL_TIMEOUT_MS)
  pendingRequests.set(requestId, { resolve: finish })
  if (signal?.aborted) {
    finish(null)
    return promise
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('ssh:credential-request', { requestId, targetId, kind, detail, echo })
  } else {
    finish(null)
  }
  return promise
}

export function registerCredentialHandler(): void {
  ipcMain.removeHandler('ssh:submitCredential')
  ipcMain.handle(
    'ssh:submitCredential',
    (_event, args: { requestId: string; value: string | null; remember?: boolean }) => {
      pendingRequests.get(args.requestId)?.resolve(args.value, args.remember === true)
    }
  )
}
