/**
 * 唯一入口：
 * - 資料索引與附件參照維持既有 parser.ts 邏輯。
 * - 預覽則使用 advancedMarkdown.ts 單一渲染核心。
 * 透過 tsconfig paths，既有呼叫端完全不需要改動。
 */
export {
  slugifyHeading,
  isVideoFile,
  isImageFile,
  parseLinksAndTags,
  extractOutlinks,
  extractTags,
  extractMediaReferences,
} from "./parser";
export { renderMarkdownToHtml } from "./advancedMarkdown";
