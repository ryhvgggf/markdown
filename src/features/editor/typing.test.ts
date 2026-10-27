import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { installTypingWatch, markTyping, isTypingKey, useTyping } from './typing'

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  useTyping.setState({ typing: false })
})

describe('typing mode', () => {
  it('starts on a typing key and ends only on real pointer movement (> 2 px)', () => {
    stop = installTypingWatch()
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 })
    markTyping()
    expect(useTyping.getState().typing).toBe(true)
    fireEvent.pointerMove(window, { clientX: 101, clientY: 101 }) // jitter
    expect(useTyping.getState().typing).toBe(true)
    fireEvent.pointerMove(window, { clientX: 104, clientY: 101 })
    expect(useTyping.getState().typing).toBe(false)
  })

  it('counts IME composition keys; Esc and menu keys are not typing', () => {
    const k = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)
    expect(isTypingKey(k({ key: 'a' }))).toBe(true)
    expect(isTypingKey(k({ key: 'Process', keyCode: 229, isComposing: true }))).toBe(true)
    expect(isTypingKey(k({ key: 'Escape' }))).toBe(false)
    expect(isTypingKey(k({ key: 'F10', shiftKey: true }))).toBe(false)
    expect(isTypingKey(k({ key: 'ContextMenu' }))).toBe(false)
  })
})
