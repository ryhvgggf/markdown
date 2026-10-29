import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { Dialog } from './Dialog'
import { Banner } from './Banner'
import { Menu } from './Menu'
import { Close } from '../icons'

describe('ui components', () => {
  it('IconButton renders aria-label', () => {
    render(
      <IconButton label="新增">
        <Close />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: '新增' })).toBeInTheDocument()
  })

  it('Button sets data-variant and defaults type to button', () => {
    render(<Button variant="primary">儲存</Button>)
    const b = screen.getByRole('button', { name: '儲存' })
    expect(b).toHaveAttribute('data-variant', 'primary')
    expect(b).toHaveAttribute('type', 'button')
  })

  it('Dialog closes on Esc and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    function Harness() {
      return (
        <Dialog title="標題" trigger={<button>開啟</button>}>
          <p>內容</p>
        </Dialog>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '開啟' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '標題' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('Banner uses alert for error, status otherwise, and dismisses', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const { rerender } = render(
      <Banner tone="error" onDismiss={onDismiss}>
        壞了
      </Banner>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('壞了')
    await user.click(screen.getByRole('button', { name: '關閉' }))
    expect(onDismiss).toHaveBeenCalled()
    rerender(<Banner tone="info">資訊</Banner>)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('Menu opens and shows items', async () => {
    const user = userEvent.setup()
    render(
      <Menu trigger={<button>更多</button>}>
        <Menu.Item onSelect={() => {}}>重新命名</Menu.Item>
      </Menu>,
    )
    await user.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('menuitem', { name: '重新命名' })).toBeInTheDocument()
  })
})

describe('Tooltip', () => {
  const tip = () => document.querySelector('[data-radix-popper-content-wrapper] [data-state]')
  const show = async (user: ReturnType<typeof userEvent.setup>) => {
    render(
      <IconButton label="搜尋" tooltip>
        <Close />
      </IconButton>,
    )
    await user.hover(screen.getByRole('button', { name: '搜尋' }))
    await vi.waitFor(() => expect(tip()).not.toBeNull(), { timeout: 2000 })
  }

  it('closes as soon as the pointer leaves the trigger, even onto the tooltip', async () => {
    const user = userEvent.setup()
    await show(user)
    await user.hover(tip() as HTMLElement) // moving from the trigger onto the tooltip
    await vi.waitFor(() => expect(tip()).toBeNull())
  })

  it('closes on pointerdown', async () => {
    const user = userEvent.setup()
    await show(user)
    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('button', { name: '搜尋' }) })
    await vi.waitFor(() => expect(tip()).toBeNull())
  })

  it('does not open from a programmatic focus() restore (e.g. a closed dialog returning focus to the button that opened it) — only from real keyboard focus, so it never ends up stuck open with nothing to hover away from', () => {
    render(
      <IconButton label="設定" tooltip>
        <Close />
      </IconButton>,
    )
    // Simulates Radix's onCloseAutoFocus calling .focus() on the button that opened a now-closed dialog —
    // not real keyboard navigation, so :focus-visible is false (same distinction Rail.tsx's own onFocus
    // fix makes for the rail itself reopening from this same event).
    act(() => screen.getByRole('button', { name: '設定' }).focus())
    expect(tip()).toBeNull()
  })
})
