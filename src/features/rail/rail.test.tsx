import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ServicesProvider } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { DEFAULT_PREFS, type Prefs } from '@/core/preferences/preferences'
import type { AppServices } from '@/app/bootstrap'
import { Rail } from './Rail'

function setup(railMode: Prefs['railMode'] = 'hover') {
  const prefs = { get: () => ({ ...DEFAULT_PREFS, railMode }), observe: () => () => undefined }
  render(
    <ServicesProvider services={{ prefs } as unknown as AppServices}>
      <Rail />
    </ServicesProvider>,
  )
  return screen.getByRole('navigation', { name: '主要功能' })
}

const press = (init: KeyboardEventInit) => act(() => void fireEvent.keyDown(window, { key: '\\', ...init }))

describe('Rail', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUi.setState({ railHover: false })
  })
  afterEach(() => vi.useRealTimers())

  it('opens on the edge zone and closes when leaving the rail', () => {
    const nav = setup()
    expect(nav).toHaveAttribute('data-open', 'false')
    fireEvent.pointerEnter(screen.getByTestId('rail-hover-zone'))
    expect(nav).toHaveAttribute('data-open', 'true')
    fireEvent.pointerLeave(nav)
    act(() => void vi.advanceTimersByTime(160))
    expect(nav).toHaveAttribute('data-open', 'false')
  })

  it('closes after a short delay, cancelled by entering the nav', () => {
    const nav = setup()
    const zone = screen.getByTestId('rail-hover-zone')
    fireEvent.pointerEnter(zone)
    fireEvent.pointerLeave(zone)
    act(() => void vi.advanceTimersByTime(100))
    expect(nav).toHaveAttribute('data-open', 'true')
    fireEvent.pointerEnter(nav)
    act(() => void vi.advanceTimersByTime(300))
    expect(nav).toHaveAttribute('data-open', 'true')
    fireEvent.pointerLeave(nav)
    act(() => void vi.advanceTimersByTime(100))
    expect(nav).toHaveAttribute('data-open', 'true')
    act(() => void vi.advanceTimersByTime(60))
    expect(nav).toHaveAttribute('data-open', 'false')
  })

  it('toggles with Ctrl+\\', () => {
    const nav = setup()
    press({ ctrlKey: true })
    expect(nav).toHaveAttribute('data-open', 'true')
    press({ ctrlKey: true })
    expect(nav).toHaveAttribute('data-open', 'false')
  })

  it('ignores the shortcut during IME composition', () => {
    const nav = setup()
    press({ ctrlKey: true, isComposing: true })
    press({ ctrlKey: true, keyCode: 229 })
    expect(nav).toHaveAttribute('data-open', 'false')
  })

  it('stays open when pinned', () => {
    const nav = setup('pinned')
    expect(nav).toHaveAttribute('data-open', 'true')
    fireEvent.pointerLeave(nav)
    act(() => void vi.advanceTimersByTime(300))
    expect(nav).toHaveAttribute('data-open', 'true')
  })

  it('does not reopen when a closed dialog programmatically refocuses its trigger button', () => {
    const nav = setup()
    expect(nav).toHaveAttribute('data-open', 'false')
    // Simulates Radix's onCloseAutoFocus calling .focus() on the button that opened the dialog —
    // not real keyboard navigation, so :focus-visible is false and the rail must stay closed.
    act(() => screen.getByRole('button', { name: '設定' }).focus())
    expect(nav).toHaveAttribute('data-open', 'false')
  })

  it('wires search and settings buttons', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }))
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    expect(useUi.getState().quickSwitcherOpen).toBe(true)
    expect(useUi.getState().settingsOpen).toBe(true)
  })
})

describe('Rail 附件', () => {
  it('opens the attachments list in the sidebar (and the sheet when narrow)', () => {
    useUi.setState({ sidebarView: 'tree', sidebarOverlayOpen: false })
    setup()
    fireEvent.click(screen.getByRole('button', { name: '附件' }))
    expect(useUi.getState().sidebarView).toBe('attachments')
    fireEvent.click(screen.getByRole('button', { name: '檔案' }))
    expect(useUi.getState().sidebarView).toBe('tree')
  })

  it('資料 opens its own window, apart from settings', () => {
    useUi.setState({ dataOpen: false, settingsOpen: false })
    setup()
    fireEvent.click(screen.getByRole('button', { name: '資料' }))
    expect(useUi.getState().dataOpen).toBe(true)
    expect(useUi.getState().settingsOpen).toBe(false)
  })
})
