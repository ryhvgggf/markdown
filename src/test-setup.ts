import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'

// jsdom has no layout: ProseMirror (coordsAtPos) and floating menus need these geometry stubs.
const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
const zeroRect = () => new DOMRect(0, 0, 0, 0)
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects ??= emptyRects
  Range.prototype.getBoundingClientRect ??= zeroRect
}
if (typeof Text !== 'undefined') (Text.prototype as unknown as { getClientRects?: () => DOMRectList }).getClientRects ??= emptyRects
