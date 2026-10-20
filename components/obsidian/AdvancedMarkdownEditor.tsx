"use client";

/**
 * 單一 MarkdownEditor 擴充層，保留現有編輯器、附件、圖譜、Mermaid 功能。
 * Notion 快捷輸入由 NotionEditorController 包裹原 textarea 實作。
 */
import { useEffect, useRef, type ComponentProps } from "react";
import { MarkdownEditor as OriginalMarkdownEditor } from "./MarkdownEditor";
import { NotionEditorController } from "./NotionEditorController";

type Props = ComponentProps<typeof OriginalMarkdownEditor>;
let mermaidModule: Promise<typeof import("mermaid")> | null = null;
let mermaidQueue: Promise<void> = Promise.resolve();
let diagramSerial = 0;

function loadMermaid(): Promise<typeof import("mermaid")> {
  if (!mermaidModule) {
    mermaidModule = import("mermaid").then((module) => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "dark",
        htmlLabels: true,
        flowchart: { htmlLabels: true, useMaxWidth: true },
      });
      return module;
    }).catch((error) => { mermaidModule = null; throw error; });
  }
  return mermaidModule;
}

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
  warning.textContent = message;
  node.prepend(warning);
  node.dataset.renderState = "error";
}

export function MarkdownEditor(props: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { note, onUpdateContent } = props;

  useEffect(() => {
    const currentWrapper = wrapperRef.current;
    if (!currentWrapper) return;
    const wrapper: HTMLDivElement = currentWrapper;
    let cancelled = false;
    document.querySelectorAll(
      'body > div[id^="dobsidian-mermaid-"], body > iframe[id^="iobsidian-mermaid-"], body > svg[id^="obsidian-mermaid-"]'
    ).forEach((element) => element.remove());

    function processDiagram(node: HTMLElement) {
      if (node.dataset.renderState) return;
      const encoded = node.dataset.mermaidSource;
      if (!encoded) return;
      node.dataset.renderState = "working";
      mermaidQueue = mermaidQueue.catch(() => undefined).then(async () => {
        if (cancelled || !node.isConnected || !wrapper.contains(node)) return;
        let source = "";
        try { source = decodeURIComponent(encoded); }
        catch { reportDiagramError(node, "Mermaid 圖表內容無法解碼，原始程式碼仍保留。"); return; }
        if (source.length > 20000) {
          reportDiagramError(node, "Mermaid 內容超過 20,000 字元的預覽限制，原始程式碼仍保留。");
          return;
        }
        if (!source.trim()) { reportDiagramError(node, "Mermaid 區塊沒有內容。"); return; }
        let scratch: HTMLDivElement | null = null;
        let id = "";
        try {
          const mermaid = await loadMermaid();
          if (cancelled || !node.isConnected || !wrapper.contains(node)) return;
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
          scratch.style.cssText = `position:fixed;left:-10000px;top:0;width:${Math.max(640, node.clientWidth)}px;height:auto;overflow:visible;opacity:0;pointer-events:none;z-index:-1;`;
          wrapper.appendChild(scratch);
          const { svg } = await mermaid.default.render(id, source, scratch);
          if (cancelled || !node.isConnected || !wrapper.contains(node)) return;
          if (!/<svg\b/i.test(svg)) throw new Error("SVG 無法顯示");
          // Mermaid strict 模式已進行安全處理；避免二次清理吃掉中文字節點。
          node.innerHTML = svg;
          node.dataset.renderState = "ready";
        } catch (error) {
          if (cancelled || !node.isConnected || !wrapper.contains(node)) return;
          const detail = error instanceof Error ? error.message.split("\n")[0].trim() : "未知錯誤";
          reportDiagramError(node, `Mermaid 圖表無法顯示：${detail.slice(0, 120) || "語法或渲染失敗"}`);
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
    return () => { cancelled = true; observer.disconnect(); };
  }, [note?.id, note?.content]);

  return (
    <div ref={wrapperRef} className="advanced-markdown-wrapper h-full min-h-0 w-full flex-1">
      <NotionEditorController content={note?.content || ""} noteId={note?.id} onUpdateContent={onUpdateContent}>
        <OriginalMarkdownEditor {...props} />
      </NotionEditorController>
    </div>
  );
}
