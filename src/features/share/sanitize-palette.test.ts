import { expect, it } from 'vitest'
import { SHARE_HIGHLIGHT_COLORS, SHARE_TEXT_COLORS } from '@/core/share/sanitize'
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '@/features/editor/marks/formatting'

it('the share allow-list colours stay in step with the editor palette', () => {
  expect(SHARE_TEXT_COLORS).toEqual(TEXT_COLORS.map((c) => c.value))
  expect(SHARE_HIGHLIGHT_COLORS).toEqual(HIGHLIGHT_COLORS.map((c) => c.value))
})
