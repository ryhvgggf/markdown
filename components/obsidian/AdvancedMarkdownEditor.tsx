"use client";

/**
 * Obsidian Markdown 編輯器的單一擴充層。
 * 不更動原本筆記儲存、Wikilink、附件或圖譜的資料結構。
 *
 * Mermaid 修正：
 * 1. 先以 parse(suppressErrors) 驗證，避免錯誤圖形進入 render。
 * 2. render 使用隔離的暫存容器，finally 一定清理，避免錯誤圖形堆在 body。
 * 3. 沿用 Mermaid securityLevel=strict 內建的 SVG 清理，避免重複清理移除中文標籤。
 */
import { useEffect, useRef, type ComponentProps, type MouseEvent } from "react";
import { MarkdownEditor as OriginalMarkdownEditor } from "./MarkdownEditor";

type Props = ComponentProps<typeof OriginalMarkdownEditor>;

let mermaidModule: Promise<typeof import("mermaid")> | null = null;
let mermaidQueue: Promise<void> = Promise.resolve();
let diagramSerial = 0;

function loadMermaid(): Promise<typeof import("mermaid")> {
  if (!mermaidModule) {
    mermaidModule = import("mermaid")
      .then((module) => {
        module.default.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "dark",
          // Mermaid 11 在部分流程圖中以 foreignObject 放置節點文字。
          // 必須允許該結構安全地通過 SVG 清理，否則框有出來、文字卻消失。
          htmlLabels: true,
          flowchart: { htmlLabels: true, useMaxWidth: true },
        });
        return module;
      })
      .catch((error) => {
        mermaidModule = null; // 載入失敗後，下次預覽仍可重試。
        throw error;
      });
  }
  return mermaidModule;
}

const TASK_PATTERN = /^((?:[ \t]*>[ \t]*)*[ \t]*(?:[-+*]|\d+[.)]|[a-zA-Z]+\)|[ivxlcdmIVXLCDM]+\.|[（(][一二三四五六七八九十百千零〇兩两]+[）)]|[一二三四五六七八九十百千零〇兩两]+[、.]|[甲乙丙丁戊己庚辛壬癸][、.]|[子丑寅卯辰巳午未申酉戌亥][、.])[ \t]*\[)([ xX])(\])/;

/** 僅清理本擴充層特定 ID 的 Mermaid 殘留物，絕不掃除其他頁面元素。 */
function cleanupMermaidArtifacts(id: string, wrapper: HTMLElement): void {
  for (const tempId of [`d${id}`, `i${id}`, id]) {
    const element = document.getElementById(tempId);
    if (element && !wrapper.contains(element)) element.remove();
  }
}

function reportDiagramError(node: HTMLElement, message: string): void {
  if (!node.isConnected) return;
  node.querySelectorAll(":scope > .obsidian-mermaid-error").forEach((item) => item.remove());
  const warning = document.createElement("div");
  warning.className = "obsidian-mermaid-error";
  warning.setAttribute("role", "status");
  // 只在對應圖表內顯示一則短訊息，不建立 Mermaid 的全頁錯誤 SVG。
  warning.textContent = message;
  node.prepend(warning);
  node.dataset.renderState = "error";
}


export function MarkdownEditor(props: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { note, onUpdateContent } = props;

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const checkbox = target.closest<HTMLInputElement>("input.obsidian-task-checkbox[data-task-line]");
    if (!checkbox || !note) return;

    event.preventDefault();
    event.stopPropagation();

    const lineNumber = Number(checkbox.dataset.taskLine);
    if (!Number.isInteger(lineNumber) || lineNumber < 0) return;
    const newline = note.content.includes("\r\n") ? "\r\n" : "\n";
    const lines = note.content.split(/\r\n|\n|\r/);
    if (lineNumber >= lines.length) return;

    const original = lines[lineNumber];
    // 保留原始 Markdown 及所有縮排、標籤、連結，只翻轉 [ ] / [x]。
    const updated = original.replace(
      TASK_PATTERN,
      (_all, before: string, checked: string, after: string) =>
        `${before}${checked.toLowerCase() === "x" ? " " : "x"}${after}`
    );
    if (updated !== original) {
      lines[lineNumber] = updated;
      onUpdateContent(lines.join(newline));
    }
  }

  useEffect(() => {
    const currentWrapper = wrapperRef.current;
    if (!currentWrapper) return;
    // 明確建立非 null 的固定參照，供非同步佇列與內部函式使用。
    // 避免 TypeScript 在巢狀函式中將 wrapper 視為 HTMLDivElement | null。
    const wrapper: HTMLDivElement = currentWrapper;
    let cancelled = false;

    // 從舊版熱更新殘留的 Mermaid 錯誤圖形只清除我們自己的臨時 ID。
    // 不會修改其他 SVG、Graph View、背景或筆記資料。
    document.querySelectorAll(
      'body > div[id^="dobsidian-mermaid-"], body > iframe[id^="iobsidian-mermaid-"], body > svg[id^="obsidian-mermaid-"]'
    ).forEach((element) => element.remove());

    function processDiagram(node: HTMLElement) {
      if (node.dataset.renderState) return;
      const encoded = node.dataset.mermaidSource;
      if (!encoded) return;
      node.dataset.renderState = "working";

      // Mermaid 共用序列佇列，避免切換筆記或快速編輯時平行產生暫存 SVG。
      mermaidQueue = mermaidQueue.catch(() => undefined).then(async () => {
        if (cancelled || !node.isConnected || !wrapper.contains(node)) return;

        let source = "";
        try {
          source = decodeURIComponent(encoded);
        } catch {
          reportDiagramError(node, "Mermaid 圖表內容無法解碼，原始程式碼仍保留。");
          return;
        }

        if (source.length > 20000) {
          reportDiagramError(node, "Mermaid 內容超過 20,000 字元的預覽限制，原始程式碼仍保留。");
          return;
        }
        if (!source.trim()) {
          reportDiagramError(node, "Mermaid 區塊沒有內容。");
          return;
        }

        let scratch: HTMLDivElement | null = null;
        let id = "";
        try {
          const mermaid = await loadMermaid();
          if (cancelled || !node.isConnected || !wrapper.contains(node)) return;

          // Mermaid 官方 API：suppressErrors 使無效語法回傳 false，
          // 不觸發全頁錯誤 SVG 或全域解析錯誤處理器。
          const valid = await mermaid.default.parse(source, { suppressErrors: true });
          if (valid === false) {
            reportDiagramError(node, "Mermaid 語法無法解析。請檢查節點括號，特殊文字可使用引號包住。");
            return;
          }
          if (cancelled || !node.isConnected || !wrapper.contains(node)) return;

          id = `obsidian-mermaid-${++diagramSerial}`;
          scratch = document.createElement("div");
          scratch.className = "obsidian-mermaid-staging";
          scratch.setAttribute("aria-hidden", "true");
          // 不用 display:none，否則 Mermaid 可能無法測量文字寬高。
          scratch.style.cssText = `position:fixed;left:-10000px;top:0;width:${Math.max(640, node.clientWidth)}px;height:auto;overflow:visible;opacity:0;pointer-events:none;z-index:-1;`;
          wrapper.appendChild(scratch);

          const { svg } = await mermaid.default.render(id, source, scratch);
          if (cancelled || !node.isConnected || !wrapper.contains(node)) return;

          // Mermaid 在 strict 模式已使用 DOMPurify 清理 SVG，並保留標籤所需
          // 的 foreignObject。再次以純 SVG profile 清理反而會使框內文字消失。
          if (!/<svg\b/i.test(svg)) throw new Error("SVG 無法顯示");
          node.innerHTML = svg;
          node.dataset.renderState = "ready";
        } catch (error) {
          if (cancelled || !node.isConnected || !wrapper.contains(node)) return;
          const detail = error instanceof Error ? error.message.split("\n")[0].trim() : "未知錯誤";
          const shortDetail = detail.length > 120 ? `${detail.slice(0, 120)}…` : detail;
          reportDiagramError(node, `Mermaid 圖表無法顯示：${shortDetail || "語法或渲染失敗"}`);
        } finally {
          scratch?.remove();
          if (id) cleanupMermaidArtifacts(id, wrapper);
        }
      });
    }

    function scan() {
      if (cancelled) return;
      wrapper.querySelectorAll<HTMLElement>(".obsidian-preview-container .obsidian-mermaid[data-mermaid-source]")
        .forEach(processDiagram);
    }

    const observer = new MutationObserver(scan);
    observer.observe(wrapper, { childList: true, subtree: true });
    scan();

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [note?.id, note?.content]);

  return (
    <div
      ref={wrapperRef}
      className="advanced-markdown-wrapper h-full min-h-0 w-full flex-1"
      onClickCapture={handleClickCapture}
    >
      <OriginalMarkdownEditor {...props} />
    </div>
  );
}
