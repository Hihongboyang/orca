// @vitest-environment happy-dom

import { act } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BackgroundImage } from '../../../../shared/types'

const mocks = vi.hoisted(() => ({
  state: {
    settings: null as { backgroundImage?: BackgroundImage; backgroundImageOpacity?: number } | null,
    updateSettings: vi.fn()
  },
  readMock: vi.fn()
}))

vi.mock('../../store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))

vi.mock('@/lib/web-client-location', () => ({
  isWebClientLocation: vi.fn(() => false)
}))

import {
  useAppBackgroundImageStyle,
  clearAppBackgroundImageCache
} from './use-app-background-image-style'

const IMAGE: BackgroundImage = {
  id: '11111111-2222-4333-8444-555566667777',
  fileName: '11111111-2222-4333-8444-555566667777.png',
  mimeType: 'image/png'
}

const mountedRoots: Root[] = []
let lastStyle: CSSProperties | undefined

function StyleProbe(): ReactElement {
  lastStyle = useAppBackgroundImageStyle()
  return <div data-testid="probe" style={lastStyle} />
}

async function renderProbe(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<StyleProbe />)
  })
}

describe('useAppBackgroundImageStyle', () => {
  beforeEach(() => {
    mocks.state.settings = null
    mocks.state.updateSettings.mockReset()
    mocks.readMock.mockReset()
    lastStyle = undefined
    // Why: the module keeps a single-entry blob cache; drop it so each test starts cold.
    clearAppBackgroundImageCache()
    ;(window as unknown as { api: unknown }).api = {
      backgroundImage: { read: mocks.readMock }
    }
  })

  afterEach(async () => {
    while (mountedRoots.length > 0) {
      const root = mountedRoots.pop()
      if (root) {
        await act(async () => {
          root.unmount()
        })
      }
    }
    document.body.innerHTML = ''
  })

  it('returns undefined when no image is set', async () => {
    mocks.state.settings = {}
    await renderProbe()
    expect(lastStyle).toBeUndefined()
    expect(mocks.readMock).not.toHaveBeenCalled()
  })

  it('loads bytes into a blob URL and paints veil-over-image layers', async () => {
    mocks.state.settings = { backgroundImage: IMAGE }
    mocks.readMock.mockResolvedValue(new ArrayBuffer(8))
    await renderProbe()
    expect(mocks.readMock).toHaveBeenCalledWith(IMAGE.id, IMAGE.fileName)
    expect(lastStyle).toBeDefined()
    expect(lastStyle?.backgroundImage).toContain('blob:')
    expect(lastStyle?.backgroundImage).toContain('linear-gradient(')
  })

  it('scales the veil with opacity (50% image = 50% base-color veil)', async () => {
    mocks.state.settings = { backgroundImage: IMAGE, backgroundImageOpacity: 0.5 }
    mocks.readMock.mockResolvedValue(new ArrayBuffer(8))
    await renderProbe()
    expect(lastStyle?.backgroundImage).toContain(' 50%,')
    expect(lastStyle?.backgroundImage).not.toContain('100%')
  })

  it('clamps out-of-range opacity values on read', async () => {
    mocks.state.settings = { backgroundImage: IMAGE, backgroundImageOpacity: 7 }
    mocks.readMock.mockResolvedValue(new ArrayBuffer(8))
    await renderProbe()
    // 7 clamps to 1 → fully shown image, 0% veil.
    expect(lastStyle?.backgroundImage).toContain(' 0%,')
  })

  it('self-heals the dangling setting when the file is missing', async () => {
    mocks.state.settings = { backgroundImage: IMAGE }
    mocks.readMock.mockResolvedValue(null)
    await renderProbe()
    expect(mocks.state.updateSettings).toHaveBeenCalledWith({ backgroundImage: undefined })
  })

  it('self-heals only once per id (no update loop)', async () => {
    // Why a fresh id: healedIds is module state and the previous test already healed IMAGE.
    const staleImage: BackgroundImage = {
      id: '99999999-8888-4777-8666-555544443333',
      fileName: '99999999-8888-4777-8666-555544443333.png',
      mimeType: 'image/png'
    }
    mocks.state.settings = { backgroundImage: staleImage }
    mocks.readMock.mockResolvedValue(null)
    await renderProbe()
    expect(mocks.state.updateSettings).toHaveBeenCalledTimes(1)
    await act(async () => {
      // Simulate a settings refresh that still carries the stale image.
      mocks.state.settings = { backgroundImage: staleImage }
    })
    expect(mocks.state.updateSettings).toHaveBeenCalledTimes(1)
  })
})
