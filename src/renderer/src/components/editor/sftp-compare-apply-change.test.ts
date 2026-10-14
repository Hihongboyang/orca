// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  applySftpLineChange,
  applyAllSftpLineChanges,
  type SftpApplyTextModel,
  type SftpLineChange
} from './sftp-compare-apply-change'

/** Minimal fake of the monaco ITextModel surface the helper depends on,
 * implemented as exact string splices over offset positions. */
function fakeModel(
  text: string
): SftpApplyTextModel & { edits: unknown[]; getValue: () => string } {
  let value = text
  const edits: unknown[] = []
  const linesOf = (): string[] => value.split('\n')
  const offsetOf = (lineNumber: number, column: number): number => {
    const lines = linesOf()
    let offset = 0
    for (let i = 0; i < lineNumber - 1; i++) {
      offset += (lines[i]?.length ?? 0) + 1
    }
    return offset + column - 1
  }
  return {
    getLineCount: () => linesOf().length,
    getLineMaxColumn: (lineNumber: number) => (linesOf()[lineNumber - 1]?.length ?? 0) + 1,
    getValueInRange: (range) => {
      const start = offsetOf(range.startLineNumber, range.startColumn)
      const end = offsetOf(range.endLineNumber, range.endColumn)
      return value.slice(start, end)
    },
    getEOL: () => '\n',
    applyEdits: (operations) => {
      for (const op of operations) {
        edits.push(op)
        const start = offsetOf(op.range.startLineNumber, op.range.startColumn)
        const end = offsetOf(op.range.endLineNumber, op.range.endColumn)
        value = value.slice(0, start) + op.text + value.slice(end)
      }
      return null
    },
    getValue: () => value,
    edits
  } as never
}

// Local (original) model is the source of truth for apply direction.
const LOCAL = 'a\nb\nc\nd'

describe('applySftpLineChange', () => {
  it('replaces a changed hunk', () => {
    const remote = fakeModel('a\nX\nc\nd')
    applySftpLineChange(remote, fakeModel(LOCAL), {
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 2
    })
    expect(remote.getValue()).toBe('a\nb\nc\nd')
  })

  it('inserts local-only lines before the modified anchor line', () => {
    // remote lacks 'b': modified side is an empty range anchored before line 2
    const remote = fakeModel('a\nc\nd')
    applySftpLineChange(remote, fakeModel(LOCAL), {
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 1 // empty modified range (insertion)
    })
    expect(remote.getValue()).toBe('a\nb\nc\nd')
  })

  it('deletes remote-only lines', () => {
    const remote = fakeModel('a\nb\nX\nY\nc\nd')
    applySftpLineChange(remote, fakeModel(LOCAL), {
      originalStartLineNumber: 3,
      originalEndLineNumber: 2, // empty original range
      modifiedStartLineNumber: 3,
      modifiedEndLineNumber: 4
    })
    expect(remote.getValue()).toBe('a\nb\nc\nd')
  })

  it('handles a hunk at end of file', () => {
    const remote = fakeModel('a\nb\nc\nD')
    applySftpLineChange(remote, fakeModel(LOCAL), {
      originalStartLineNumber: 4,
      originalEndLineNumber: 4,
      modifiedStartLineNumber: 4,
      modifiedEndLineNumber: 4
    })
    expect(remote.getValue()).toBe('a\nb\nc\nd')
  })

  it('handles insertion at end of file', () => {
    const remote = fakeModel('a\nb\nc')
    applySftpLineChange(remote, fakeModel('a\nb\nc\nd'), {
      originalStartLineNumber: 4,
      originalEndLineNumber: 4,
      modifiedStartLineNumber: 4,
      modifiedEndLineNumber: 3 // empty modified range at EOF
    })
    expect(remote.getValue()).toBe('a\nb\nc\nd')
  })

  it('is a no-op for an empty-on-both-sides change', () => {
    const remote = fakeModel('a\nb')
    applySftpLineChange(remote, fakeModel('a\nb'), {
      originalStartLineNumber: 3,
      originalEndLineNumber: 2,
      modifiedStartLineNumber: 3,
      modifiedEndLineNumber: 2
    })
    expect(remote.getValue()).toBe('a\nb')
    expect(remote.edits).toHaveLength(0)
  })
})

describe('applyAllSftpLineChanges', () => {
  it('applies every hunk in one pass', () => {
    const remote = fakeModel('a\nX\nc\nY\nZ\ne')
    const changes: SftpLineChange[] = [
      {
        originalStartLineNumber: 2,
        originalEndLineNumber: 2,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 2
      },
      {
        originalStartLineNumber: 4,
        originalEndLineNumber: 4,
        modifiedStartLineNumber: 4,
        modifiedEndLineNumber: 5
      }
    ]
    applyAllSftpLineChanges(remote, fakeModel('a\nb\nc\nd\ne'), changes)
    expect(remote.getValue()).toBe('a\nb\nc\nd\ne')
  })

  it('is a no-op with no changes', () => {
    const remote = fakeModel('a\nb')
    applyAllSftpLineChanges(remote, fakeModel('a\nb'), [])
    expect(remote.getValue()).toBe('a\nb')
    expect(remote.edits).toHaveLength(0)
  })
})
