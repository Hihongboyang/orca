// Chunk-apply for the SFTP compare dialog (add-sftp-compare-edit D4):
// convert one monaco ILineChange into an edit that makes the remote model's
// hunk match the local model. Structural model surface keeps this testable
// without a live Monaco.

export type SftpApplyEditRange = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export type SftpApplyTextModel = {
  getLineCount(): number
  getLineMaxColumn(lineNumber: number): number
  getValueInRange(range: SftpApplyEditRange): string
  getEOL(): string
  applyEdits(operations: { range: SftpApplyEditRange; text: string }[]): unknown
}

export type SftpLineChange = {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

/** Apply one change: remote hunk := local hunk. No-op when both sides empty.
 * Monotone encoding: empty ranges encode as start = end + 1. */
export function applySftpLineChange(
  remoteModel: SftpApplyTextModel,
  localModel: SftpApplyTextModel,
  change: SftpLineChange
): void {
  const hasLocalLines = change.originalStartLineNumber <= change.originalEndLineNumber
  const hasRemoteLines = change.modifiedStartLineNumber <= change.modifiedEndLineNumber

  if (!hasLocalLines && !hasRemoteLines) {
    return
  }

  const localText = hasLocalLines
    ? localModel.getValueInRange({
        startLineNumber: change.originalStartLineNumber,
        startColumn: 1,
        endLineNumber: change.originalEndLineNumber,
        endColumn: localModel.getLineMaxColumn(change.originalEndLineNumber)
      })
    : ''

  if (hasRemoteLines) {
    // Replace the covered full-line range. Deletion must also swallow one
    // adjacent line break (full-line ranges exclude newlines), or an empty
    // line would remain where the hunk was.
    const startLine = change.modifiedStartLineNumber
    const endLine = change.modifiedEndLineNumber
    const lastLine = remoteModel.getLineCount()
    const range: SftpApplyEditRange = {
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn: remoteModel.getLineMaxColumn(endLine)
    }
    if (localText === '' && endLine < lastLine) {
      range.endLineNumber = endLine + 1
      range.endColumn = 1
    } else if (localText === '' && startLine > 1) {
      range.startLineNumber = startLine - 1
      range.startColumn = remoteModel.getLineMaxColumn(startLine - 1)
    }
    remoteModel.applyEdits([{ range, text: localText }])
    return
  }

  // Insertion. The anchor line may sit one past EOF (monaco encodes an EOF
  // insertion as start = lineCount + 1), where no valid position exists —
  // append after the last line's end instead.
  const lastLine = remoteModel.getLineCount()
  const eol = remoteModel.getEOL()
  if (change.modifiedStartLineNumber > lastLine) {
    const endColumn = remoteModel.getLineMaxColumn(lastLine)
    remoteModel.applyEdits([
      {
        range: {
          startLineNumber: lastLine,
          startColumn: endColumn,
          endLineNumber: lastLine,
          endColumn
        },
        text: `${eol}${localText}`
      }
    ])
    return
  }
  const intoEmptyModel = lastLine === 1 && remoteModel.getLineMaxColumn(1) === 1
  remoteModel.applyEdits([
    {
      range: {
        startLineNumber: change.modifiedStartLineNumber,
        startColumn: 1,
        endLineNumber: change.modifiedStartLineNumber,
        endColumn: 1
      },
      text: intoEmptyModel ? localText : `${localText}${eol}`
    }
  ])
}

/** Apply every change bottom-up so earlier line numbers stay valid. */
export function applyAllSftpLineChanges(
  remoteModel: SftpApplyTextModel,
  localModel: SftpApplyTextModel,
  changes: readonly SftpLineChange[]
): void {
  const ordered = [...changes].sort((a, b) => b.modifiedStartLineNumber - a.modifiedStartLineNumber)
  for (const change of ordered) {
    applySftpLineChange(remoteModel, localModel, change)
  }
}
