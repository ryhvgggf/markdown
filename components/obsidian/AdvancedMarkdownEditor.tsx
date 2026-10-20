"use client";

/**
 * 原 MarkdownEditor 唯一的擴充層。
 * 不修改原始編輯、附件、Wikilink、圖譜或預覽的操作模式。
 */
import { useEffect, useRef, type ComponentProps, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { MarkdownEditor as OriginalMarkdownEditor } from "./MarkdownEditor";

type Props = ComponentProps<typeof OriginalMarkdownEditor>;

let mermaidModule: Promise<typeof import("mermaid")> | null = null;
let mermaidQueue: Promise<void> = Promise.resolve();
let diagramSerial = 0;

function loadMermaid(): Promise<typeof import("mermaid")> {
  if (!mermaidModule) {
    mermaidModule = import("mermaid").then((module) => {
      module.default.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        flowchart: { htmlLabels: false },
      });
      return module;
    });
  }
  return mermaidModule;
}

const TASK_PATTERN = /^((?:[ \t]*>[ \t]*)*[ \t]*(?:[-+*]|\d+[.)]|[a-zA-Z]+\)|[ivxlcdmIVXLCDM]+\.|[（(][一二三四五六七八九十百千零〇兩两]+[）)]|[一二三四五六七八九十百千零〇兩两]+[、.]|[甲乙丙丁戊己庚辛壬癸][、.]|[子丑寅卯辰巳午未申酉戌亥][、.])[ \t]*\[)([ xX])(\])/;

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
    // 只更動 [ ] / [x] 的一個字元；其餘文字、連結、縮排全部保留。
    const updated = original.replace(TASK_PATTERN, (_all, before: string, checked: string, after: string) =>
      `${before}${checked.toLowerCase() === "x" ? " " : "x"}${after}`
    );
    if (updated !== original) {
      lines[lineNumber] = updated;
      onUpdateContent(lines.join(newline));
    }
  }

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let cancelled = false;

    function processDiagram(node: HTMLElement) {
      if (node.dataset.renderState) return;
      const encoded = node.dataset.mermaidSource;
      if (!encoded) return;
      node.dataset.renderState = "working";

      // Mermaid render 使用共享佇列，避免同時生成 SVG 時彼此干擾。
      mermaidQueue = mermaidQueue.catch(() => undefined).then(async () => {
        if (cancelled || !node.isConnected || !wrapper?.contains(node)) return;
        let source = "";
        try { source = decodeURIComponent(encoded); }
        catch {
          node.dataset.renderState = "error";
          return;
        }
        if (source.length > 20000) {
          node.dataset.renderState = "error";
          const warning = document.createElement("div");
          warning.className = "obsidian-mermaid-error";
          warning.textContent = "Mermaid 程式碼超過 20,000 字元的預覽限制，原始碼仍保留。";
          node.prepend(warning);
          return;
        }
        if (!source.trim()) {
          node.dataset.renderState = "error";
          return;
        }
        try {
          const mermaid = await loadMermaid();
          const id = `obsidian-mermaid-${++diagramSerial}`;
          const { svg } = await mermaid.default.render(id, source);
          if (cancelled || !node.isConnected || !wrapper?.contains(node)) return;
          const safeSvg = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          });
          if (!safeSvg || !safeSvg.includes("<svg")) throw new Error("產生的圖形無法安全顯示");
          node.innerHTML = safeSvg;
          node.dataset.renderState = "ready";
        } catch (error) {
          if (cancelled || !node.isConnected) return;
          // 初始 <pre> 原始碼保留，不將 Mermaid 錯誤文字當 HTML 注入。
          const message = document.createElement("div");
          message.className = "obsidian-mermaid-error";
          message.textContent = `Mermaid 圖形解析失敗：${error instanceof Error ? error.message : "未知錯誤"}`;
          node.prepend(message);
          node.dataset.renderState = "error";
        }
      });
    }

    function scan() {
      if (cancelled) return;
      wrapper?.querySelectorAll<HTMLElement>(".obsidian-preview-container .obsidian-mermaid[data-mermaid-source]")
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
    <div ref={wrapperRef} className="advanced-markdown-wrapper h-full min-h-0 w-full flex-1" onClickCapture={handleClickCapture}>
      <OriginalMarkdownEditor {...props} />
    </div>
  );
}
