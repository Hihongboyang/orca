import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainCss = fs.readFileSync(new URL('./main.css', import.meta.url), 'utf8')

function getCssRuleBody(selector: string): string {
  const ruleMarker = mainCss.indexOf(`\n${selector} {`)
  expect(ruleMarker).toBeGreaterThanOrEqual(0)

  const ruleStart = ruleMarker + 1
  const bodyStart = mainCss.indexOf('{', ruleStart) + 1
  const bodyEnd = mainCss.indexOf('}', bodyStart)
  return mainCss.slice(bodyStart, bodyEnd)
}

// Why: the wallpaper veils are pure CSS wired to marker classes on React
// containers — a renamed class or deleted rule fails silently at runtime, so
// pin the selector↔class contract (mirrors worktree-card-active-style.test.ts).
describe('app background image wallpaper surfaces', () => {
  it('veils --editor-surface in both themes only in wallpaper mode', () => {
    const light = getCssRuleBody('.app-background-image')
    const lightSurface = light.match(/--editor-surface: ([^;]+);/)
    expect(lightSurface?.[1]).toBe('color-mix(in srgb, #ffffff 86%, transparent)')

    const dark = getCssRuleBody('.dark .app-background-image')
    expect(dark).toContain('--editor-surface: color-mix(in srgb, #1e1e1e 86%, transparent)')
  })

  it('makes Monaco transparent so the veiled host surface shows', () => {
    // Why the grouped rule is pinned via its trailing selector: the leading
    // selector ends in a comma, so only the last one matches "selector {".
    expect(mainCss).toContain('.app-background-image .monaco-editor,')
    const groupBody = getCssRuleBody('.app-background-image .monaco-editor-background')
    expect(groupBody).toContain('background-color: transparent')
  })

  it('paints the editor host and both sidebars from their own tokens', () => {
    expect(getCssRuleBody('.app-background-image .editor-surface-host')).toContain(
      'background-color: var(--editor-surface)'
    )
    expect(getCssRuleBody('.app-background-image .right-sidebar-surface')).toContain(
      'color-mix(in srgb, var(--sidebar) 86%, transparent)'
    )
    expect(getCssRuleBody('.app-background-image .worktree-sidebar-surface')).toContain(
      'color-mix(in srgb, var(--worktree-sidebar) 86%, transparent)'
    )
    // Why: unlike the sidebars, the tab strip paints no plate at all — the
    // wallpaper shows through at the slider-controlled image opacity.
    expect(getCssRuleBody('.app-background-image .tab-strip-surface')).toContain(
      'background-color: transparent'
    )
    expect(getCssRuleBody('.app-background-image .tab-plate-inactive')).toContain(
      'background-color: transparent'
    )
    expect(getCssRuleBody('.app-background-image .tab-plate-active')).toContain(
      'color-mix(in srgb, var(--foreground) 6%, transparent)'
    )
  })

  it('keeps the wallpaper fit fixed to cover + center', () => {
    const fit = mainCss.slice(
      mainCss.indexOf('.app-background-image {'),
      mainCss.indexOf('.app-background-image {') + 300
    )
    expect(fit).toContain('background-size: cover')
    expect(fit).toContain('background-position: center')
    expect(fit).toContain('background-repeat: no-repeat')
  })

  it('mounts the marker classes the veils target', () => {
    const rendererSrc = new URL('../', import.meta.url)
    const read = (relative: string): string =>
      fs.readFileSync(new URL(relative, rendererSrc), 'utf8')
    expect(read('components/editor/EditorPanelShell.tsx')).toContain('editor-surface-host')
    expect(read('components/right-sidebar/index.tsx')).toContain('right-sidebar-surface')
    expect(read('components/sidebar/index.tsx')).toContain('worktree-sidebar-surface')
    expect(read('components/tab-group/TabGroupPanel.tsx')).toContain('tab-strip-surface')
    // Why: the root class itself is conditionally applied in App.tsx.
    expect(read('App.tsx')).toContain("' app-background-image'")
  })
})
