import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  SftpWorkspaceProfile,
  SftpTransferProgress,
  SftpTransferFileOutcome
} from '../../../../shared/sftp-types'

export type SftpTransferCard = {
  transferId: string
  /** Renderer-minted correlation key (D14); survives transferId adoption so
   *  the failure path (which only knows the requestId) can still find the card. */
  requestId?: string
  direction: 'upload' | 'download'
  profileLabel: string
  phase: 'connecting' | 'transferring' | 'done'
  filesDone: number
  filesTotal: number
  currentPath: string
  cancelled: boolean
  error: string | null
  /** Parsed `sftp-error:` code for pre-start failures, when present. */
  errorCode?: string
  /** Host key for host-key-mismatch failures (drives the clear-trust warning). */
  errorHostKey?: string
  /** Null while in flight; the completion summary once done (D9). */
  outcomes: SftpTransferFileOutcome[] | null
}

/** One-shot modal error for a failed explorer action (add-sftp-action-error-dialog D1). */
export type SftpActionError = {
  /** Parsed `sftp-error:` code ('' when unparsed). */
  code: string
  message: string
}

export type SftpSlice = {
  sftpProfilesByWorkspace: Record<string, SftpWorkspaceProfile[]>
  sftpTransferCards: SftpTransferCard[]
  sftpActionError: SftpActionError | null
  setSftpActionError: (error: SftpActionError | null) => void
  setSftpProfiles: (workspacePath: string, profiles: SftpWorkspaceProfile[]) => void
  getSftpProfiles: (workspacePath: string) => SftpWorkspaceProfile[]
  beginSftpTransferCard: (card: {
    transferId: string
    direction: 'upload' | 'download'
    profileLabel: string
  }) => void
  updateSftpTransferProgress: (progress: SftpTransferProgress) => void
  finishSftpTransfer: (
    result: {
      transferId: string
      cancelled: boolean
      outcomes: SftpTransferFileOutcome[]
    },
    requestId?: string
  ) => void
  failSftpTransfer: (transferId: string, error: string, code?: string) => void
  dismissSftpTransferCard: (transferId: string) => void
}
export const createSftpSlice: StateCreator<AppState, [], [], SftpSlice> = (set, get) => ({
  sftpProfilesByWorkspace: {},
  sftpTransferCards: [],
  sftpActionError: null,

  setSftpActionError: (error) => {
    set({ sftpActionError: error })
  },

  setSftpProfiles: (workspacePath, profiles) => {
    set((state) => ({
      sftpProfilesByWorkspace: { ...state.sftpProfilesByWorkspace, [workspacePath]: profiles }
    }))
  },

  getSftpProfiles: (workspacePath) => get().sftpProfilesByWorkspace[workspacePath] ?? [],

  beginSftpTransferCard: (card) => {
    set((state) => ({
      sftpTransferCards: [
        ...state.sftpTransferCards,
        {
          transferId: card.transferId,
          requestId: card.transferId,
          direction: card.direction,
          profileLabel: card.profileLabel,
          phase: 'connecting',
          filesDone: 0,
          filesTotal: 0,
          currentPath: '',
          cancelled: false,
          error: null,
          outcomes: null
        }
      ]
    }))
  },

  updateSftpTransferProgress: (progress) => {
    // Why: cards open with the renderer-minted requestId (D14); the first
    // progress event adopts main's transferId (cancel needs it) but must keep
    // the requestId identity — rejection handlers only know the requestId.
    const correlationId = progress.requestId ?? progress.transferId
    set((state) => ({
      sftpTransferCards: state.sftpTransferCards.map((card) =>
        (card.requestId === correlationId || card.transferId === correlationId) &&
        card.phase !== 'done'
          ? {
              ...card,
              transferId: progress.transferId,
              phase: progress.phase,
              filesDone: progress.filesDone,
              filesTotal: progress.filesTotal,
              currentPath: progress.currentPath
            }
          : card
      )
    }))
  },

  finishSftpTransfer: (result, requestId) => {
    set((state) => ({
      sftpTransferCards: state.sftpTransferCards.map((card) =>
        card.transferId === result.transferId || (requestId && card.transferId === requestId)
          ? {
              ...card,
              transferId: result.transferId,
              phase: 'done',
              cancelled: result.cancelled,
              outcomes: result.outcomes
            }
          : card
      )
    }))
  },

  failSftpTransfer: (transferId, error, code) => {
    set((state) => ({
      sftpTransferCards: state.sftpTransferCards.map((card) =>
        card.transferId === transferId || card.requestId === transferId
          ? {
              ...card,
              phase: 'done',
              error,
              errorCode: code || undefined,
              // Why: mismatch messages are built as `Host key for host:port changed…`.
              errorHostKey:
                code === 'host-key-mismatch'
                  ? (error.match(/Host key for (\S+) changed/)?.[1] ?? undefined)
                  : undefined
            }
          : card
      )
    }))
  },

  dismissSftpTransferCard: (transferId) => {
    set((state) => ({
      sftpTransferCards: state.sftpTransferCards.filter((card) => card.transferId !== transferId)
    }))
  }
})
