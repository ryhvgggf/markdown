/**
 * 唯一的 Markdown 預覽渲染引擎：CommonMark / GFM + Obsidian 擴充。
 * 資料庫、Metadata、Wikilink 的索引仍沿用 lib/obsidian/parser.ts。
 * 所有 HTML 最終由既有 MarkdownEditor 的 DOMPurify 清理。
 */
import MarkdownIt from "markdown-it";
import markdownItFootnote from "markdown-it-footnote";
import katex from "katex";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import java from "highlight.js/lib/languages/java";
import { abapHighlight } from "./abapHighlight";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import markdown from "highlight.js/lib/languages/markdown";
import { slugifyHeading, isVideoFile } from "./parser";

const syntaxLanguages: Array<[string, typeof javascript]> = [
  ["javascript", javascript], ["typescript", typescript], ["java", java],
  ["abap", abapHighlight], ["sql", sql], ["xml", xml], ["json", json],
  ["css", css], ["bash", bash], ["python", python], ["markdown", markdown],
];
for (const [name, definition] of syntaxLanguages) hljs.registerLanguage(name, definition);
hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["sh", "zsh", "shell"], { languageName: "bash" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["md"], { languageName: "markdown" });

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderMath(value: string, displayMode: boolean): string {
  try {
    return katex.renderToString(value, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: "warn",
      maxSize: 20,
      maxExpand: 1000,
      output: "htmlAndMathml",
    });
  } catch {
    return `<code class="obsidian-math-error">${escapeHtml(value)}</code>`;
  }
}

type RenderEnvironment = {
  existingTitles: string[];
  currentNoteTitle: string;
  originalLines: string[];
  customMarkers: Map<number, { marker: string; style: string }>;
};

type CalloutSpec = {
  title: string;
  cssType: string;
  collapsible: boolean;
  expanded: boolean;
};
const CALLOUT_NAMES: Record<string, string> = {
  note: "筆記", abstract: "摘要", summary: "摘要", tldr: "摘要",
  info: "資訊", todo: "待辦", tip: "提示", hint: "提示", important: "重要",
  success: "成功", check: "成功", done: "完成", question: "問題", help: "說明",
  faq: "常見問題", warning: "警告", caution: "注意", attention: "注意",
  failure: "失敗", fail: "失敗", missing: "缺少", danger: "危險",
  error: "錯誤", bug: "錯誤", example: "範例", quote: "引言", cite: "引言",
};

function readCallout(firstLine: string): { spec: CalloutSpec; rest: string } | null {
  const m = /^\[!([a-zA-Z]+)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n|$)/.exec(firstLine);
  if (!m) return null;
  const key = m[1].toLowerCase();
  if (!CALLOUT_NAMES[key]) return null;
  const title = (m[3] || "").trim() || CALLOUT_NAMES[key];
  return {
    spec: { title, cssType: key, collapsible: Boolean(m[2]), expanded: m[2] !== "-" },
    rest: firstLine.slice(m[0].length),
  };
}

/** 兼容原本的中文／英文字母／羅馬數字清單，不改寫使用者儲存的 Markdown。 */
function normalizeCustomLists(markdown: string): {
  source: string;
  customMarkers: RenderEnvironment["customMarkers"];
} {
  const customMarkers = new Map<number, { marker: string; style: string }>();
  const patterns: Array<[RegExp, string]> = [
    [/^([ \t]*)([a-zA-Z]+\))([ \t]+)(.*)$/, "alpha"],
    [/^([ \t]*)([ivxlcdmIVXLCDM]+\.)([ \t]+)(.*)$/, "roman"],
    [/^([ \t]*)([（(][一二三四五六七八九十百千零〇兩两]+[）)])([ \t]*)(.*)$/, "cn-parentheses"],
    [/^([ \t]*)([一二三四五六七八九十百千零〇兩两]+[、.])([ \t]*)(.*)$/, "cn-ideographic"],
    [/^([ \t]*)([甲乙丙丁戊己庚辛壬癸][、.])([ \t]*)(.*)$/, "cn-heavenly"],
    [/^([ \t]*)([子丑寅卯辰巳午未申酉戌亥][、.])([ \t]*)(.*)$/, "cn-earthly"],
  ];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let fenceChar = "";
  let fenceLength = 0;
  const normalized = lines.map((line, number) => {
    // 引用中的中文清單也要支援；保留 > 前綴與行數。
    const quotePrefix = /^( {0,3}(?:> ?)+)/.exec(line)?.[0] || "";
    const body = line.slice(quotePrefix.length);
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(body);
    if (fence) {
      if (!fenceChar) {
        fenceChar = fence[1][0];
        fenceLength = fence[1].length;
      } else if (fence[1][0] === fenceChar && fence[1].length >= fenceLength && !fence[2].trim()) {
        fenceChar = "";
        fenceLength = 0;
      }
      return line;
    }
    if (fenceChar || /^ {4,}\S/.test(body)) return line;
    for (const [regex, kind] of patterns) {
      const match = regex.exec(body);
      if (!match) continue;
      const marker = match[2];
      let style = kind;
      if (kind === "alpha") style = marker[0] === marker[0].toUpperCase() ? "upper-alpha-paren" : "lower-alpha-paren";
      if (kind === "roman") style = marker[0] === marker[0].toUpperCase() ? "upper-roman" : "lower-roman";
      customMarkers.set(number, { marker, style });
      // 與標準 Markdown 共用清單解析，原文仍照原樣存入 IndexedDB。
      return `${quotePrefix}${match[1]}1. ${match[4]}`;
    }
    return line;
  });
  return { source: normalized.join("\n"), customMarkers };
}

const md = new MarkdownIt({ html: true, linkify: true, breaks: false, typographer: false });
// GFM 會辨識 www.example.com 等無協定網址。
md.linkify.set({ fuzzyLink: true });
// markdown-it v15 暴露 Token constructor；用作 core 規則插入標題/勾選元件。
const TokenConstructor = (MarkdownIt as unknown as { Token: new (type: string, tag: string, nesting: number) => any }).Token;
md.use(markdownItFootnote);

// 數學區塊 $$...$$；放在 fenced code 前面檢查，但不改變 ``` 行為。
md.block.ruler.before("fence", "obsidian_math_block", (state: any, startLine: number, endLine: number, silent: boolean) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const end = state.eMarks[startLine];
  const raw = state.src.slice(start, end).trim();
  if (!raw.startsWith("$$")) return false;
  let next = startLine + 1;
  let tex = raw.slice(2);
  const sameLineEnd = tex.indexOf("$$");
  if (sameLineEnd >= 0) {
    tex = tex.slice(0, sameLineEnd);
  } else {
    let matched = false;
    while (next < endLine) {
      const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
      const closing = line.indexOf("$$");
      if (closing >= 0) {
        tex += `\n${line.slice(0, closing)}`;
        matched = true;
        next += 1;
        break;
      }
      tex += `\n${line}`;
      next += 1;
    }
    if (!matched) return false;
  }
  if (silent) return true;
  const token = state.push("obsidian_math_block", "div", 0);
  token.content = tex.trim();
  token.map = [startLine, next];
  state.line = next;
  return true;
});

md.inline.ruler.before("escape", "obsidian_inline_math", (state: any, silent: boolean) => {
  const src: string = state.src;
  const pos: number = state.pos;
  let opener = "";
  let closer = "";
  if (src.startsWith("\\(", pos)) { opener = "\\("; closer = "\\)"; }
  else if (src[pos] === "$" && src[pos + 1] !== "$" && (pos === 0 || src[pos - 1] !== "\\")) {
    if (/\s/.test(src[pos + 1] || "") || (pos > 0 && /\d/.test(src[pos - 1]))) return false;
    opener = "$";
    closer = "$";
  } else return false;
  let end = src.indexOf(closer, pos + opener.length);
  while (end !== -1 && src[end - 1] === "\\" && closer === "$") end = src.indexOf(closer, end + closer.length);
  if (end < 0) return false;
  const content = src.slice(pos + opener.length, end);
  if (!content.trim() || /\n/.test(content) || /\s$/.test(content)) return false;
  if (!silent) {
    const token = state.push("obsidian_math_inline", "span", 0);
    token.content = content;
  }
  state.pos = end + closer.length;
  return true;
});

md.renderer.rules.obsidian_math_inline = (tokens: any[], idx: number) => renderMath(tokens[idx].content, false);
md.renderer.rules.obsidian_math_block = (tokens: any[], idx: number) =>
  `<div class="obsidian-math-block">${renderMath(tokens[idx].content, true)}</div>`;

// GFM 規範允許 ~單波浪線~ 刪除線；舊的 ~下標~ 改用 <sub>。
md.inline.ruler.before("strikethrough", "gfm_single_tilde", (state: any, silent: boolean) => {
  const src: string = state.src;
  const pos: number = state.pos;
  if (src[pos] !== "~" || src[pos + 1] === "~" || src[pos - 1] === "~") return false;
  const end = src.indexOf("~", pos + 1);
  if (end <= pos + 1 || src[end + 1] === "~") return false;
  const inner = src.slice(pos + 1, end);
  if (/^\s|\s$|\n/.test(inner)) return false;
  if (!silent) {
    const t = state.push("gfm_single_tilde", "del", 0);
    t.content = inner;
  }
  state.pos = end + 1;
  return true;
});
md.renderer.rules.gfm_single_tilde = (tokens: any[], idx: number, _opt: any, env: any) =>
  `<del>${md.renderInline(tokens[idx].content, env)}</del>`;

// 螢光標記 ==...==，保留你的原有 Obsidian 寫法。
md.inline.ruler.before("emphasis", "obsidian_highlight", (state: any, silent: boolean) => {
  if (!state.src.startsWith("==", state.pos)) return false;
  const end = state.src.indexOf("==", state.pos + 2);
  if (end <= state.pos + 2) return false;
  const content = state.src.slice(state.pos + 2, end);
  if (/^\s|\s$/.test(content)) return false;
  if (!silent) {
    const t = state.push("obsidian_highlight", "mark", 0);
    t.content = content;
  }
  state.pos = end + 2;
  return true;
});
md.renderer.rules.obsidian_highlight = (tokens: any[], i: number) =>
  `<mark>${md.renderInline(tokens[i].content)}</mark>`;

// GFM 使用單個 ~ 作刪除線，避免與舊版 ~下標~ 衝突。
// 原版 ^上標^ 保留；下標可用安全的 <sub>文字</sub> HTML 寫法。
md.inline.ruler.before("emphasis", "obsidian_superscript", (state: any, silent: boolean) => {
  if (state.src[state.pos] !== "^") return false;
  const end = state.src.indexOf("^", state.pos + 1);
  if (end <= state.pos + 1) return false;
  const content = state.src.slice(state.pos + 1, end);
  if (!content.trim() || /\s/.test(content)) return false;
  if (!silent) {
    const t = state.push("obsidian_sup", "sup", 0);
    t.content = content;
  }
  state.pos = end + 1;
  return true;
});
md.renderer.rules.obsidian_sup = (ts: any[], i: number) => `<sup>${escapeHtml(ts[i].content)}</sup>`;

// Obsidian 的 [[筆記]] / ![[附件]] / #標籤，保持現有 data-* 事件接口。
md.inline.ruler.before("link", "obsidian_wikilink", (state: any, silent: boolean) => {
  const rest: string = state.src.slice(state.pos);
  const media = /^!\[\[([^|\]#]+)(?:\|([^\]]+))?\]\]/.exec(rest);
  if (media) {
    if (!silent) {
      const ref = media[1].trim();
      const name = (media[2] || ref).trim();
      const type = /\.(jpg|jpeg|png|gif|webp|svg|avif|ico|bmp)$/i.test(name) ? "image"
        : /\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(name) ? "video"
        : /\.(mp3|wav|m4a|flac|aac|wma)$/i.test(name) ? "audio" : "file";
      const t = state.push("html_inline", "", 0);
      t.content = `<span class="obsidian-media-container my-3 inline-block max-w-full overflow-hidden" data-media-id="${escapeHtml(ref)}" data-media-name="${escapeHtml(name)}" data-media-type="${type}"><span class="text-xs text-slate-400 font-mono">載入檔案：${escapeHtml(name)}</span></span>`;
    }
    state.pos += media[0].length;
    return true;
  }
  const match = /^\[\[([^|\]#]*)(?:#([^|\]#]+))?(?:\|([^\]]+))?\]\]/.exec(rest);
  if (!match) return false;
  if (!silent) {
    const env = state.env as RenderEnvironment;
    const target = (match[1] || "").trim();
    const heading = (match[2] || "").trim();
    const effectiveTitle = target || env.currentNoteTitle;
    const label = (match[3] || "").trim() || (!target ? `#${heading}` : heading ? `${target} > #${heading}` : target);
    const exists = !target || env.existingTitles.some(x => x.trim().toLowerCase() === effectiveTitle.toLowerCase());
    const classes = exists ? "text-cyan-300" : "text-cyan-300/60 border-b border-dashed border-cyan-600/40";
    const t = state.push("html_inline", "", 0);
    t.content = `<a href="#" class="obsidian-wikilink ${classes}" data-note-title="${escapeHtml(effectiveTitle)}" data-heading-target="${escapeHtml(heading)}" data-heading-slug="${escapeHtml(heading ? slugifyHeading(heading) : "")}">${escapeHtml(label)}</a>`;
  }
  state.pos += match[0].length;
  return true;
});
md.inline.ruler.before("emphasis", "obsidian_tags", (state: any, silent: boolean) => {
  if (state.src[state.pos] !== "#") return false;
  if (state.pos !== 0 && !/[\s([{]/.test(state.src[state.pos - 1])) return false;
  const match = /^#([a-zA-Z0-9_\u4e00-\u9fa5-]+)/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const t = state.push("html_inline", "", 0);
    t.content = `<span class="obsidian-tag" data-tag="${escapeHtml(match[1])}">#${escapeHtml(match[1])}</span>`;
  }
  state.pos += match[0].length;
  return true;
});

md.renderer.rules.fence = (tokens: any[], idx: number) => {
  const token = tokens[idx];
  const language = (token.info || "").trim().split(/\s+/)[0].toLowerCase();
  if (language === "mermaid") {
    return `<div class="obsidian-mermaid" data-mermaid-source="${escapeHtml(encodeURIComponent(token.content))}" role="img" aria-label="Mermaid 流程圖"><pre>${escapeHtml(token.content)}</pre></div>`;
  }
  let code = escapeHtml(token.content);
  if (language && hljs.getLanguage(language)) {
    try { code = hljs.highlight(token.content, { language, ignoreIllegals: true }).value; }
    catch { /* 無效的語言內容仍以純文字安全呈現 */ }
  }
  return `<pre class="obsidian-code-block my-3 overflow-x-auto rounded border border-white/5"><code class="hljs language-${escapeHtml(language)}">${code}</code></pre>`;
};
md.renderer.rules.code_block = (tokens: any[], idx: number) =>
  `<pre class="obsidian-code-block"><code class="hljs">${escapeHtml(tokens[idx].content)}</code></pre>`;
md.renderer.rules.image = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  const token = tokens[idx];
  const src = token.attrGet("src") || "";
  if (isVideoFile(src)) {
    return `<video src="${escapeHtml(src)}" controls preload="metadata" class="my-3 max-h-96 max-w-full rounded border border-white/10"></video>`;
  }
  token.attrJoin("class", "my-3 max-h-96 max-w-full rounded border border-white/10 object-contain");
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.table_open = (tokens: any[], idx: number, options: any, _env: any, self: any) => {
  tokens[idx].attrJoin("class", "obsidian-markdown-table");
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.link_open = (tokens: any[], idx: number, options: any, _env: any, self: any) => {
  const t = tokens[idx];
  const href = t.attrGet("href") || "";
  if (/^(?:https?:|mailto:)/i.test(href)) {
    t.attrSet("target", "_blank");
    t.attrSet("rel", "noopener noreferrer");
  }
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.heading_open = (tokens: any[], idx: number, options: any, _env: any, self: any) => {
  const inline = tokens[idx + 1];
  const heading = inline?.content || "";
  const slug = slugifyHeading(heading);
  tokens[idx].attrSet("id", slug);
  tokens[idx].attrSet("data-heading-slug", slug);
  return self.renderToken(tokens, idx, options);
};

// Core rules use tokens from the single markdown-it parsing pass.
md.core.ruler.after("inline", "obsidian_callouts", (state: any) => {
  const tokens: any[] = state.tokens;
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i].type !== "blockquote_open") continue;
    if (tokens[i + 1].type !== "paragraph_open" || tokens[i + 2].type !== "inline") continue;
    const parsed = readCallout(tokens[i + 2].content);
    if (!parsed) continue;
    const { spec, rest } = parsed;
    const fullBody = rest;
    const opener = tokens[i];
    opener.attrJoin("class", `obsidian-callout obsidian-callout--${spec.cssType}`);
    const titleMarkup = md.renderInline(spec.title, state.env);
    const title = spec.collapsible
      ? `<summary class="obsidian-callout-title">${titleMarkup}</summary>`
      : `<div class="obsidian-callout-title">${titleMarkup}</div>`;
    if (spec.collapsible) {
      opener.tag = "details";
      if (spec.expanded) opener.attrSet("open", "");
      let depth = 0;
      for (let j = i; j < tokens.length; j += 1) {
        if (tokens[j].type === "blockquote_open") depth += 1;
        if (tokens[j].type === "blockquote_close") {
          depth -= 1;
          if (depth === 0) { tokens[j].tag = "details"; break; }
        }
      }
    }
    const titleToken = new TokenConstructor("html_block", "", 0);
    titleToken.content = title;
    tokens.splice(i + 1, 0, titleToken);
    const inner = tokens[i + 3];
    inner.content = fullBody;
    inner.children = md.parseInline(fullBody, state.env)[0]?.children || [];
  }
});

md.core.ruler.after("obsidian_callouts", "obsidian_tasks", (state: any) => {
  const tokens: any[] = state.tokens;
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i].type !== "list_item_open") continue;
    const paragraph = tokens[i + 1];
    const inline = tokens[i + 2];
    if (paragraph?.type !== "paragraph_open" || inline?.type !== "inline") continue;
    const task = /^\[([ xX])\][ \t]+/.exec(inline.content);
    if (!task) continue;
    const line = tokens[i].map?.[0];
    if (typeof line !== "number") continue;
    const checked = task[1].toLowerCase() === "x";
    tokens[i].attrJoin("class", `task-list-item${checked ? " is-checked" : ""}`);
    const checkbox = `<input type="checkbox" class="obsidian-task-checkbox" data-task-line="${line}" aria-label="切換待辦事項"${checked ? " checked" : ""} /> `;
    const text = inline.content.slice(task[0].length);
    const newChildren = md.parseInline(text, state.env)[0]?.children || [];
    const prefix = new TokenConstructor("html_inline", "", 0);
    prefix.content = checkbox;
    inline.content = text;
    inline.children = [prefix, ...newChildren];
  }
});

md.core.ruler.after("obsidian_tasks", "obsidian_custom_lists", (state: any) => {
  const env = state.env as RenderEnvironment;
  const tokens: any[] = state.tokens;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "ordered_list_open") {
      const firstLine = token.map?.[0];
      const custom = firstLine === undefined ? undefined : env.customMarkers.get(firstLine);
      if (custom) token.attrJoin("class", `obsidian-list obsidian-list--custom obsidian-list--${custom.style}`);
    }
    if (token.type === "list_item_open") {
      const line = token.map?.[0];
      const custom = line === undefined ? undefined : env.customMarkers.get(line);
      if (custom) token.attrSet("data-list-marker", custom.marker);
    }
  }
});

/**
 * 保持舊 MarkdownEditor 既有 props 簽名；只會用這一套渲染器輸出 HTML。
 */
export function renderMarkdownToHtml(
  markdownText: string,
  existingTitles: string[] = [],
  currentNoteTitle = ""
): string {
  if (!markdownText) return "";
  const original = markdownText.replace(/\r\n?/g, "\n");
  const normalized = normalizeCustomLists(original);
  const env: RenderEnvironment = {
    existingTitles,
    currentNoteTitle,
    originalLines: original.split("\n"),
    customMarkers: normalized.customMarkers,
  };
  return md.render(normalized.source, env);
}
