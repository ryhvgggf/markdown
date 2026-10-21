import { describe, expect, it } from 'vitest'
import { isComposingEvent } from './ime'

const ev = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)

describe('isComposingEvent', () => {
  it('detects isComposing', () => expect(isComposingEvent(ev({ key: 'Enter', isComposing: true }))).toBe(true))
  it('detects keyCode 229', () => expect(isComposingEvent(ev({ key: 'Enter', keyCode: 229 }))).toBe(true))
  it('detects view.composing', () => {
    expect(isComposingEvent(ev({ key: 'Enter' }), { composing: true } as never)).toBe(true)
  })
  it('is false for a plain Enter', () => expect(isComposingEvent(ev({ key: 'Enter' }))).toBe(false))
})
