// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDefaultSettings } from '../../../../shared/constants'
import type { BackgroundImage, GlobalSettings } from '../../../../shared/types'

const mocks = vi.hoisted(() => ({
  state: {
    settingsSearchQuery: '',
    openSettingsTarget: vi.fn()
  },
  importMock: vi.fn(),
  readMock: vi.fn(),
  deleteMock: vi.fn()
}))

vi.mock('../../store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))

vi.mock('../background-image/use-app-background-image-style', () => ({
  clearAppBackgroundImageCache: vi.fn(),
  peekAppBackgroundImageUrl: vi.fn(() => null),
  readAppBackgroundImageUrl: vi.fn(() => Promise.resolve('blob:mock-background'))
}))

vi.mock('@/lib/web-client-location', () => ({
  isWebClientLocation: vi.fn(() => false)
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() }
}))

import { BackgroundImageSetting } from './BackgroundImageSetting'
import { isWebClientLocation } from '@/lib/web-client-location'

const mountedRoots: Root[] = []

async function renderRow(settings: GlobalSettings): Promise<HTMLDivElement> {
  const updateSettings = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<BackgroundImageSetting settings={settings} updateSettings={updateSettings} />)
  })
  return Object.assign(container, { __updateSettings: updateSettings })
}

function rowUpdateSettings(container: HTMLDivElement): ReturnType<typeof vi.fn> {
  return (container as HTMLDivElement & { __updateSettings: ReturnType<typeof vi.fn> })
    .__updateSettings
}

const IMAGE: BackgroundImage = {
  id: '9a5d3c2e-1111-4222-8333-444455556666',
  fileName: '9a5d3c2e-1111-4222-8333-444455556666.png',
  mimeType: 'image/png'
}

describe('BackgroundImageSetting', () => {
  beforeEach(() => {
    mocks.state.openSettingsTarget.mockReset()
    mocks.importMock.mockReset()
    mocks.readMock.mockReset()
    mocks.deleteMock.mockReset()
    vi.mocked(isWebClientLocation).mockReturnValue(false)
    ;(window as unknown as { api: unknown }).api = {
      backgroundImage: {
        import: mocks.importMock,
        read: mocks.readMock,
        delete: mocks.deleteMock
      }
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

  it('offers Choose Image when no background is set', async () => {
    const container = await renderRow(getDefaultSettings('/tmp'))
    expect(container.textContent).toContain('Choose Image…')
    expect(container.querySelector('input[type="range"]')).toBeNull()
  })

  it('imports a picked image into settings', async () => {
    const container = await renderRow(getDefaultSettings('/tmp'))
    mocks.importMock.mockResolvedValue(IMAGE)
    const choose = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Choose Image…')
    )
    await act(async () => {
      choose?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mocks.importMock).toHaveBeenCalled()
    expect(rowUpdateSettings(container)).toHaveBeenCalledWith({ backgroundImage: IMAGE })
  })

  it('keeps settings untouched when the picker is canceled', async () => {
    const container = await renderRow(getDefaultSettings('/tmp'))
    mocks.importMock.mockResolvedValue(null)
    const choose = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Choose Image…')
    )
    await act(async () => {
      choose?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(rowUpdateSettings(container)).not.toHaveBeenCalled()
  })

  it('shows filename, opacity slider at 100%, and the terminal hint when an image is set', async () => {
    const settings = { ...getDefaultSettings('/tmp'), backgroundImage: IMAGE }
    const container = await renderRow(settings)
    expect(container.textContent).toContain(IMAGE.fileName)
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')
    expect(slider).not.toBeNull()
    expect(slider?.value).toBe('100')
    expect(container.textContent).toContain('Lower terminal background opacity')
  })

  it('hides the hint once terminal background opacity is below 1', async () => {
    const settings = {
      ...getDefaultSettings('/tmp'),
      backgroundImage: IMAGE,
      terminalBackgroundOpacity: 0.8
    }
    const container = await renderRow(settings)
    expect(container.textContent).not.toContain('Lower terminal background opacity')
  })

  it('persists opacity changes as a 0-1 float', async () => {
    const settings = { ...getDefaultSettings('/tmp'), backgroundImage: IMAGE }
    const container = await renderRow(settings)
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')
    expect(slider).not.toBeNull()
    await act(async () => {
      if (slider) {
        // Why native setter: React's value tracker swallows plain .value writes, so onChange would never fire.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          slider,
          '50'
        )
        slider.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    expect(rowUpdateSettings(container)).toHaveBeenCalledWith({ backgroundImageOpacity: 0.5 })
  })

  it('hint link deep-links to the terminal background opacity row', async () => {
    const settings = { ...getDefaultSettings('/tmp'), backgroundImage: IMAGE }
    const container = await renderRow(settings)
    const link = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Lower terminal background opacity')
    )
    expect(link).toBeDefined()
    await act(async () => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mocks.state.openSettingsTarget).toHaveBeenCalledWith({
      pane: 'appearance',
      repoId: null,
      sectionId: 'terminal-background-opacity'
    })
  })

  it('removing deletes the stored file and clears the setting', async () => {
    const settings = { ...getDefaultSettings('/tmp'), backgroundImage: IMAGE }
    const container = await renderRow(settings)
    const remove = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Remove')
    )
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mocks.deleteMock).toHaveBeenCalledWith(IMAGE.id, IMAGE.fileName)
    expect(rowUpdateSettings(container)).toHaveBeenCalledWith({ backgroundImage: undefined })
  })

  it('renders nothing on the web client', async () => {
    vi.mocked(isWebClientLocation).mockReturnValue(true)
    const container = await renderRow(getDefaultSettings('/tmp'))
    expect(container.textContent).toBe('')
  })
})
