/**
 * Markdown / Wikilink / Tag / Media parser.
 *
 * Supports CommonMark-style block and inline Markdown plus useful GFM features:
 * headings, paragraphs, emphasis, strikethrough, code, fenced code, blockquotes,
 * nested lists, task lists, tables, horizontal rules, links, images, autolinks,
 * reference links, footnotes, Obsidian wikilinks, tags and local media embeds.
 *
 * The returned HTML is sanitized by DOMPurify in MarkdownEditor.tsx before render.
 */

export interface ParsedLinksAndTags {
  outgoingLinks: string[];
  tags: string[];
  embeddedMedia: string[];
  headings: string[];
}

interface MarkdownReference {
  url: string;
  title?: string;
}

interface MarkdownContext {
  existingTitles: string[];
  currentNoteTitle: string;
  references: Map<string, MarkdownReference>;
  footnotes: Map<string, string>;
  usedFootnotes: string[];
}

interface ListMarker {
  indent: number;
  indentChars: number;
  marker: string;
  style: string;
  ordered: boolean;
  content: string;
  contentIndent: number;
  startNumber: number;
}

export function slugifyHeading(text: string): string {
  const clean = text
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .trim()
    .toLowerCase();

  return "heading-" + encodeURIComponent(clean.replace(/\s+/g, "-"));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeReferenceId(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getFileType(filename: string): string {
  const lower = filename.toLowerCase().split(/[?#]/)[0];

  if (/\.(jpg|jpeg|png|gif|webp|svg|avif|ico|bmp)$/i.test(lower)) return "image";
  if (/\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(lower)) return "video";
  if (/\.(mp3|wav|ogg|m4a|flac|aac|wma)$/i.test(lower)) return "audio";
  if (/\.pdf$/i.test(lower)) return "pdf";
  if (/\.(xlsx?|csv|numbers)$/i.test(lower)) return "excel";
  if (/\.(docx?|pages|rtf)$/i.test(lower)) return "doc";
  if (/\.(pptx?|keynote)$/i.test(lower)) return "ppt";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lower)) return "archive";
  if (/\.(txt|md|json|js|ts|tsx|jsx|py|html|css|xml|yaml|yml)$/i.test(lower)) return "text";

  return "file";
}

export function isVideoFile(filename: string): boolean {
  return /\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(filename.split(/[?#]/)[0]);
}

export function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(filename.split(/[?#]/)[0]);
}

/** Remove fenced and inline code before indexing links/tags. */
function removeCodeForExtraction(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let fenceChar = "";
  let fenceLength = 0;

  for (const line of lines) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);

    if (fence) {
      const marker = fence[1];
      if (!fenceChar) {
        fenceChar = marker[0];
        fenceLength = marker.length;
        output.push("");
        continue;
      }

      if (marker[0] === fenceChar && marker.length >= fenceLength) {
        fenceChar = "";
        fenceLength = 0;
        output.push("");
        continue;
      }
    }

    output.push(fenceChar ? "" : line);
  }

  return output.join("\n").replace(/(`+)([^`\n]*?)\1/g, "");
}

export function parseLinksAndTags(content: string): ParsedLinksAndTags {
  if (!content) {
    return { outgoingLinks: [], tags: [], embeddedMedia: [], headings: [] };
  }

  const cleanContent = removeCodeForExtraction(content);
  const embeddedMedia: string[] = [];
  const embedRegex = /!\[\[([^|\]#]+)(?:\|[^\]]+)?\]\]/g;
  let embedMatch: RegExpExecArray | null;

  while ((embedMatch = embedRegex.exec(cleanContent)) !== null) {
    const ref = embedMatch[1].trim();
    if (ref && !embeddedMedia.includes(ref)) embeddedMedia.push(ref);
  }

  const withoutEmbeds = cleanContent.replace(/!\[\[[^\]]+\]\]/g, "");
  const outgoingLinks: string[] = [];
  const linkRegex = /\[\[([^|\]#]*)(?:#([^|\]#]+))?(?:\|([^\]]+))?\]\]/g;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRegex.exec(withoutEmbeds)) !== null) {
    const target = (linkMatch[1] || "").trim();
    if (target && !outgoingLinks.includes(target)) outgoingLinks.push(target);
  }

  const tags: string[] = [];
  const tagContent = cleanContent.replace(/^ {0,3}#{1,6}\s+/gm, "");
  const tagRegex = /(?:^|[\s([{])#([a-zA-Z0-9_\u4e00-\u9fa5-]+)(?=$|[\s.,;:!?)}\]])/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(tagContent)) !== null) {
    const tag = tagMatch[1].trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }

  const headings: string[] = [];
  const headingRegex = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm;
  let headingMatch: RegExpExecArray | null;

  while ((headingMatch = headingRegex.exec(cleanContent)) !== null) {
    const heading = headingMatch[1].trim();
    if (heading && !headings.includes(heading)) headings.push(heading);
  }

  return { outgoingLinks, tags, embeddedMedia, headings };
}

export function extractOutlinks(content: string): string[] {
  return parseLinksAndTags(content).outgoingLinks;
}

export function extractTags(content: string): string[] {
  return parseLinksAndTags(content).tags;
}

export function extractMediaReferences(content: string): string[] {
  return parseLinksAndTags(content).embeddedMedia;
}

function findMatchingBracket(source: string, openIndex: number, openChar: string, closeChar: string): number {
  let depth = 0;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function parseDestination(raw: string): { url: string; title?: string } | null {
  const value = raw.trim();
  if (!value) return null;

  const angle = /^<([^>]*)>(?:\s+["']([\s\S]*?)["'])?$/.exec(value);
  if (angle) return { url: angle[1], title: angle[2] };

  const withTitle = /^((?:\\.|[^\s])+?)(?:\s+["']([\s\S]*?)["'])?$/.exec(value);
  if (!withTitle) return null;

  return {
    url: withTitle[1].replace(/\\([()\\])/g, "$1"),
    title: withTitle[2],
  };
}

function renderWikilink(targetValue: string, headingValue: string, aliasValue: string, context: MarkdownContext): string {
  const target = targetValue.trim();
  const heading = headingValue.trim();
  const alias = aliasValue.trim();
  const localHeadingOnly = !target && Boolean(heading);
  const effectiveTitle = target || context.currentNoteTitle;

  let displayText = alias;
  if (!displayText) {
    if (localHeadingOnly) displayText = `#${heading}`;
    else if (heading) displayText = `${target} > #${heading}`;
    else displayText = target;
  }

  const exists = localHeadingOnly || context.existingTitles.some(
    (title) => title.trim().toLowerCase() === effectiveTitle.trim().toLowerCase()
  );
  const headingSlug = heading ? slugifyHeading(heading) : "";
  const stateClass = exists
    ? "text-cyan-300"
    : "text-cyan-300/60 border-b border-dashed border-cyan-600/40";

  return `<a href="#" class="obsidian-wikilink ${stateClass}" data-note-title="${escapeHtml(effectiveTitle)}" data-heading-target="${escapeHtml(heading)}" data-heading-slug="${escapeHtml(headingSlug)}">${escapeHtml(displayText)}</a>`;
}

function renderInline(source: string, context: MarkdownContext, depth = 0): string {
  if (!source) return "";
  if (depth > 12) return escapeHtml(source);

  let output = "";
  let index = 0;

  while (index < source.length) {
    const rest = source.slice(index);
    const char = source[index];

    // Backslash escapes for Markdown punctuation.
    if (char === "\\" && index + 1 < source.length && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[index + 1])) {
      output += escapeHtml(source[index + 1]);
      index += 2;
      continue;
    }

    // Inline code spans. The closing backtick run must match the opening run.
    if (char === "`") {
      let runEnd = index;
      while (source[runEnd] === "`") runEnd += 1;
      const delimiter = source.slice(index, runEnd);
      let close = source.indexOf(delimiter, runEnd);

      while (close !== -1 && source[close - 1] === "`") {
        close = source.indexOf(delimiter, close + delimiter.length);
      }

      if (close !== -1) {
        let code = source.slice(runEnd, close).replace(/\n/g, " ");
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        output += `<code class="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">${escapeHtml(code)}</code>`;
        index = close + delimiter.length;
        continue;
      }
    }

    // Obsidian media embeds: ![[media-id|filename.ext]]
    const mediaMatch = /^!\[\[([^|\]#]+)(?:\|([^\]]+))?\]\]/.exec(rest);
    if (mediaMatch) {
      const ref = mediaMatch[1].trim();
      const label = String(mediaMatch[2] || ref).trim();
      const fileType = getFileType(label || ref);
      output += `<div class="obsidian-media-container my-3 inline-block max-w-full overflow-hidden" data-media-id="${escapeHtml(ref)}" data-media-name="${escapeHtml(label)}" data-media-type="${escapeHtml(fileType)}"><span class="text-xs text-slate-400 font-mono">載入檔案：${escapeHtml(label)}</span></div>`;
      index += mediaMatch[0].length;
      continue;
    }

    // Obsidian wikilinks, including heading targets and aliases.
    const wikilinkMatch = /^\[\[([^|\]#]*)(?:#([^|\]#]+))?(?:\|([^\]]+))?\]\]/.exec(rest);
    if (wikilinkMatch) {
      output += renderWikilink(wikilinkMatch[1] || "", wikilinkMatch[2] || "", wikilinkMatch[3] || "", context);
      index += wikilinkMatch[0].length;
      continue;
    }

    // Images and links: inline destination or reference-style destination.
    const isImage = char === "!" && source[index + 1] === "[";
    const bracketIndex = isImage ? index + 1 : index;

    if (source[bracketIndex] === "[") {
      const bracketEnd = findMatchingBracket(source, bracketIndex, "[", "]");
      if (bracketEnd !== -1) {
        const label = source.slice(bracketIndex + 1, bracketEnd);
        let after = bracketEnd + 1;
        let destination: MarkdownReference | undefined;
        let consumedEnd = after;

        if (source[after] === "(") {
          const parenEnd = findMatchingBracket(source, after, "(", ")");
          if (parenEnd !== -1) {
            const parsed = parseDestination(source.slice(after + 1, parenEnd));
            if (parsed) {
              destination = parsed;
              consumedEnd = parenEnd + 1;
            }
          }
        } else if (source[after] === "[") {
          const refEnd = findMatchingBracket(source, after, "[", "]");
          if (refEnd !== -1) {
            const referenceId = normalizeReferenceId(source.slice(after + 1, refEnd) || label);
            destination = context.references.get(referenceId);
            if (destination) consumedEnd = refEnd + 1;
          }
        } else {
          destination = context.references.get(normalizeReferenceId(label));
        }

        if (destination) {
          const url = escapeHtml(destination.url);
          const title = destination.title ? ` title="${escapeHtml(destination.title)}"` : "";

          if (isImage) {
            const alt = escapeHtml(label.replace(/[`*_~]/g, ""));
            if (isVideoFile(destination.url)) {
              output += `<video src="${url}" controls preload="metadata" class="my-3 max-h-96 max-w-full rounded border border-white/10"><span>${alt}</span></video>`;
            } else {
              output += `<img src="${url}" alt="${alt}"${title} loading="lazy" class="my-3 max-h-96 max-w-full rounded border border-white/10 object-contain" />`;
            }
          } else {
            output += `<a href="${url}"${title} target="_blank" rel="noopener noreferrer" class="text-cyan-300 underline">${renderInline(label, context, depth + 1)}</a>`;
          }

          index = consumedEnd;
          continue;
        }
      }
    }

    // Footnote references: [^note-id]
    const footnoteMatch = /^\[\^([^\]]+)\]/.exec(rest);
    if (footnoteMatch && context.footnotes.has(footnoteMatch[1])) {
      const id = footnoteMatch[1];
      if (!context.usedFootnotes.includes(id)) context.usedFootnotes.push(id);
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "-");
      output += `<sup class="obsidian-footnote-ref"><a href="#footnote-${escapeHtml(safeId)}" id="footnote-ref-${escapeHtml(safeId)}">${escapeHtml(id)}</a></sup>`;
      index += footnoteMatch[0].length;
      continue;
    }

    // Autolinks: <https://example.com> and <person@example.com>
    const autoLink = /^<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>/.exec(rest);
    if (autoLink) {
      const rawUrl = autoLink[1];
      const href = rawUrl.includes(":") ? rawUrl : `mailto:${rawUrl}`;
      output += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-cyan-300 underline">${escapeHtml(rawUrl)}</a>`;
      index += autoLink[0].length;
      continue;
    }

    // Raw HTML is passed through here; DOMPurify sanitizes it before display.
    const htmlToken = /^(?:<!--[\s\S]*?-->|<![A-Z][^>]*>|<\/?[A-Za-z][^>]*>)/i.exec(rest);
    if (char === "<" && htmlToken) {
      output += htmlToken[0];
      index += htmlToken[0].length;
      continue;
    }

    // Bare URLs (GFM autolinks).
    const bareUrl = /^(https?:\/\/[^\s<>]+)(?=$|\s|[<])/i.exec(rest);
    if (bareUrl) {
      const rawUrl = bareUrl[1];
      const url = rawUrl.replace(/[.,!?;:]+$/, "");
      const tail = rawUrl.slice(url.length);
      output += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-cyan-300 underline">${escapeHtml(url)}</a>${escapeHtml(tail)}`;
      index += rawUrl.length;
      continue;
    }

    // Strong, emphasis and GFM strikethrough.
    const delimiters: Array<{ token: string; tag: string; className?: string }> = [
      { token: "**", tag: "strong", className: "font-bold text-white" },
      { token: "__", tag: "strong", className: "font-bold text-white" },
      { token: "~~", tag: "del", className: "line-through text-slate-500" },
      { token: "==", tag: "mark", className: "rounded bg-amber-300/20 px-0.5 text-amber-100" },
    ];

    let handledDelimiter = false;
    for (const delimiter of delimiters) {
      if (!rest.startsWith(delimiter.token)) continue;
      const close = source.indexOf(delimiter.token, index + delimiter.token.length);
      if (close <= index + delimiter.token.length) continue;
      const inner = source.slice(index + delimiter.token.length, close);
      if (!inner.trim() || /^\s|\s$/.test(inner)) continue;
      const classAttr = delimiter.className ? ` class="${delimiter.className}"` : "";
      output += `<${delimiter.tag}${classAttr}>${renderInline(inner, context, depth + 1)}</${delimiter.tag}>`;
      index = close + delimiter.token.length;
      handledDelimiter = true;
      break;
    }
    if (handledDelimiter) continue;

    if (char === "*" || char === "_") {
      // Avoid treating double delimiters as single emphasis.
      if (source[index + 1] !== char && !(char === "_" && index > 0 && /[\w]/.test(source[index - 1]))) {
        const close = source.indexOf(char, index + 1);
        if (close > index + 1 && source[close - 1] !== " " && source[index + 1] !== " ") {
          const inner = source.slice(index + 1, close);
          if (!inner.includes("\n")) {
            output += `<em class="italic text-slate-300">${renderInline(inner, context, depth + 1)}</em>`;
            index = close + 1;
            continue;
          }
        }
      }
    }

    // Superscript and subscript extensions: ^text^ and ~text~.
    if ((char === "^" || char === "~") && source[index + 1] && !/\s/.test(source[index + 1])) {
      const close = source.indexOf(char, index + 1);
      if (close > index + 1 && !/\s/.test(source[close - 1])) {
        const inner = source.slice(index + 1, close);
        if (!inner.includes("\n")) {
          const tag = char === "^" ? "sup" : "sub";
          output += `<${tag}>${renderInline(inner, context, depth + 1)}</${tag}>`;
          index = close + 1;
          continue;
        }
      }
    }

    // Tags are recognized only at a word boundary, not inside URLs or identifiers.
    if (char === "#" && (index === 0 || /[\s([{]/.test(source[index - 1]))) {
      const tagMatch = /^#([a-zA-Z0-9_\u4e00-\u9fa5-]+)/.exec(rest);
      if (tagMatch) {
        const tag = tagMatch[1];
        output += `<span class="obsidian-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`;
        index += tagMatch[0].length;
        continue;
      }
    }

    if (char === "\n") {
      output += " ";
      index += 1;
      continue;
    }

    output += escapeHtml(char);
    index += 1;
  }

  return output;
}

function countIndent(line: string): { spaces: number; chars: number } {
  const match = /^[ \t]*/.exec(line);
  const indent = match ? match[0] : "";
  return {
    spaces: indent.replace(/\t/g, "    ").length,
    chars: indent.length,
  };
}

function getListMarker(line: string): ListMarker | null {
  const patterns: Array<{ regex: RegExp; getStyle: (marker: string) => string; ordered: boolean }> = [
    { regex: /^([ \t]*)([-+*])([ \t]+)(.*)$/, getStyle: () => "unordered", ordered: false },
    { regex: /^([ \t]*)(\d+\.)([ \t]+)(.*)$/, getStyle: () => "decimal-dot", ordered: true },
    { regex: /^([ \t]*)(\d+\))([ \t]+)(.*)$/, getStyle: () => "decimal-paren", ordered: true },
    { regex: /^([ \t]*)([a-z]+\))([ \t]+)(.*)$/i, getStyle: (marker) => marker[0] === marker[0].toUpperCase() ? "upper-alpha-paren" : "lower-alpha-paren", ordered: true },
    { regex: /^([ \t]*)([ivxlcdm]+\.)([ \t]+)(.*)$/i, getStyle: (marker) => marker[0] === marker[0].toUpperCase() ? "upper-roman" : "lower-roman", ordered: true },
    { regex: /^([ \t]*)(（[一二三四五六七八九十百千零〇兩两]+）|\([一二三四五六七八九十百千零〇兩两]+\))([ \t]*)(.*)$/, getStyle: () => "cn-parentheses", ordered: true },
    { regex: /^([ \t]*)([一二三四五六七八九十百千零〇兩两]+[、.])([ \t]*)(.*)$/, getStyle: () => "cn-ideographic", ordered: true },
    { regex: /^([ \t]*)([甲乙丙丁戊己庚辛壬癸][、.])([ \t]*)(.*)$/, getStyle: () => "cn-heavenly", ordered: true },
    { regex: /^([ \t]*)([子丑寅卯辰巳午未申酉戌亥][、.])([ \t]*)(.*)$/, getStyle: () => "cn-earthly", ordered: true },
  ];

  for (const pattern of patterns) {
    const match = pattern.regex.exec(line);
    if (!match) continue;

    const indentText = match[1];
    const marker = match[2];
    const spacing = match[3];
    const indent = indentText.replace(/\t/g, "    ").length;
    const markerWidth = marker.length + spacing.replace(/\t/g, "    ").length;
    const startNumber = /^\d/.test(marker) ? Number.parseInt(marker, 10) : 1;

    return {
      indent,
      indentChars: indentText.length,
      marker,
      style: pattern.getStyle(marker),
      ordered: pattern.ordered,
      content: match[4],
      contentIndent: indent + markerWidth,
      startNumber,
    };
  }

  return null;
}
function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  let escaped = false;
  let codeTicks = 0;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      current += char;
      continue;
    }

    if (char === "`") {
      let end = i;
      while (value[end] === "`") end += 1;
      const runLength = end - i;
      if (codeTicks === 0) codeTicks = runLength;
      else if (codeTicks === runLength) codeTicks = 0;
      current += value.slice(i, end);
      i = end - 1;
      continue;
    }

    if (char === "|" && codeTicks === 0) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function isHorizontalRule(line: string): boolean {
  return /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line.trimEnd());
}

function isFence(line: string): RegExpExecArray | null {
  return /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] || "";
  if (!line.trim()) return true;
  if (isFence(line)) return true;
  if (/^ {0,3}#{1,6}(?:\s+|$)/.test(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (isHorizontalRule(line)) return true;
  if (getListMarker(line)) return true;
  if (/^ {0,3}<(?:!--|\/?(?:address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|script|section|style|table|ul)\b)/i.test(line)) return true;
  if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) return true;
  if (index + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1]) && line.trim()) return true;
  return false;
}

function renderTable(lines: string[], context: MarkdownContext): { html: string; nextIndex: number } {
  const headers = splitTableRow(lines[0]);
  const alignments = splitTableRow(lines[1]).map((cell) => {
    const value = cell.replace(/\s/g, "");
    if (value.startsWith(":") && value.endsWith(":")) return "center";
    if (value.endsWith(":")) return "right";
    return "left";
  });

  const renderCell = (cell: string, align: string, isHeader: boolean) => {
    const tag = isHeader ? "th" : "td";
    const alignClass = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
    return `<${tag} class="${alignClass}">${renderInline(cell, context)}</${tag}>`;
  };

  const html: string[] = ['<table class="obsidian-markdown-table"><thead><tr>'];
  headers.forEach((cell, index) => html.push(renderCell(cell, alignments[index] || "left", true)));
  html.push("</tr></thead><tbody>");

  let index = 2;
  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    const cells = splitTableRow(lines[index]);
    html.push("<tr>");
    headers.forEach((_header, cellIndex) => {
      html.push(renderCell(cells[cellIndex] || "", alignments[cellIndex] || "left", false));
    });
    html.push("</tr>");
    index += 1;
  }

  html.push("</tbody></table>");
  return { html: html.join(""), nextIndex: index };
}

function renderList(lines: string[], startIndex: number, context: MarkdownContext, depth: number): { html: string; nextIndex: number } {
  const firstMarker = getListMarker(lines[startIndex]);
  if (!firstMarker) return { html: "", nextIndex: startIndex + 1 };

  const baseIndent = firstMarker.indent;
  const ordered = firstMarker.ordered;
  const style = firstMarker.style;
  const listTag = ordered ? "ol" : "ul";
  const isCustomMarker = style !== "unordered" && style !== "decimal-dot";
  const startAttr = style === "decimal-dot" && firstMarker.startNumber !== 1
    ? ` start="${firstMarker.startNumber}"`
    : "";
  const classAttr = isCustomMarker ? ` class="obsidian-list obsidian-list--custom obsidian-list--${style}"` : "";
  const items: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const marker = getListMarker(lines[index]);
    if (!marker || marker.indent !== baseIndent || marker.style !== style) break;

    let firstLine = marker.content;
    let taskState: boolean | null = null;
    const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(firstLine);
    if (taskMatch) {
      taskState = taskMatch[1].toLowerCase() === "x";
      firstLine = taskMatch[2];
    }

    const itemLines: string[] = [firstLine];
    index += 1;

    while (index < lines.length) {
      const current = lines[index];
      const currentMarker = getListMarker(current);

      if (currentMarker && currentMarker.indent === baseIndent) break;

      if (!current.trim()) {
        let lookahead = index + 1;
        while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
        const lookaheadMarker = lookahead < lines.length ? getListMarker(lines[lookahead]) : null;

        if (lookaheadMarker && lookaheadMarker.indent === baseIndent && lookaheadMarker.style === style) {
          itemLines.push("");
          index = lookahead;
          break;
        }

        if (lookahead < lines.length) {
          const lookaheadIndent = countIndent(lines[lookahead]).spaces;
          if (lookaheadIndent > baseIndent) {
            itemLines.push("");
            index += 1;
            continue;
          }
        }

        index += 1;
        break;
      }

      const currentIndent = countIndent(current);
      if (currentIndent.spaces > baseIndent) {
        const stripCount = Math.min(currentIndent.chars, Math.max(1, marker.contentIndent));
        itemLines.push(current.slice(stripCount));
        index += 1;
        continue;
      }

      if (isBlockStart(lines, index)) break;

      // CommonMark permits lazy continuation lines without indentation.
      itemLines.push(current);
      index += 1;
    }

    let itemHtml = renderBlocks(itemLines, context, depth + 1);
    const customMarkerAttr = isCustomMarker ? ` data-list-marker="${escapeHtml(marker.marker)}"` : "";
    if (taskState !== null) {
      const checkbox = `<input type="checkbox" disabled${taskState ? " checked" : ""} aria-label="待辦事項" />`;
      itemHtml = itemHtml.replace(/^<p>/, `<p>${checkbox} `);
      items.push(`<li class="task-list-item${taskState ? " is-checked" : ""}"${customMarkerAttr}>${itemHtml}</li>`);
    } else {
      items.push(`<li${customMarkerAttr}>${itemHtml}</li>`);
    }
  }

  return {
    html: `<${listTag}${classAttr}${startAttr}>${items.join("")}</${listTag}>`,
    nextIndex: index,
  };
}
function renderBlocks(sourceLines: string[], context: MarkdownContext, depth = 0): string {
  if (depth > 12) return `<p>${escapeHtml(sourceLines.join(" "))}</p>`;

  const lines = [...sourceLines];
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    // Fenced code blocks (``` or ~~~), optionally with a language label.
    const fence = isFence(line);
    if (fence) {
      const marker = fence[1];
      const language = fence[2].trim().split(/\s+/)[0] || "";
      const codeLines: string[] = [];
      index += 1;
      let closed = false;

      while (index < lines.length) {
        const closeMatch = /^ {0,3}(`+|~+)[ \t]*$/.exec(lines[index]);
        if (closeMatch && closeMatch[1][0] === marker[0] && closeMatch[1].length >= marker.length) {
          closed = true;
          index += 1;
          break;
        }
        codeLines.push(lines[index]);
        index += 1;
      }

      const langClass = language ? ` class="language-${escapeHtml(language.replace(/[^a-zA-Z0-9_-]/g, ""))}"` : "";
      output.push(`<pre class="my-3 overflow-x-auto rounded bg-black/25 p-4 font-mono text-xs border border-white/5"><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      if (!closed && codeLines.length === 0) output.push("");
      continue;
    }

    // ATX headings H1-H6.
    const headingMatch = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
      const slug = slugifyHeading(headingText);
      output.push(`<h${level} id="${escapeHtml(slug)}" data-heading-slug="${escapeHtml(slug)}">${renderInline(headingText, context)}</h${level}>`);
      index += 1;
      continue;
    }

    // Setext headings: text followed by === or ---.
    if (index + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1])) {
      const level = lines[index + 1].trim().startsWith("=") ? 1 : 2;
      const headingText = line.trim();
      const slug = slugifyHeading(headingText);
      output.push(`<h${level} id="${escapeHtml(slug)}" data-heading-slug="${escapeHtml(slug)}">${renderInline(headingText, context)}</h${level}>`);
      index += 2;
      continue;
    }

    // Horizontal rule.
    if (isHorizontalRule(line)) {
      output.push("<hr />");
      index += 1;
      continue;
    }

    // Blockquotes support nested Markdown and consecutive lines.
    if (/^ {0,3}>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quoteLine = lines[index];
        if (/^ {0,3}>/.test(quoteLine)) {
          quoteLines.push(quoteLine.replace(/^ {0,3}> ?/, ""));
          index += 1;
          continue;
        }
        if (!quoteLine.trim()) {
          let next = index + 1;
          while (next < lines.length && !lines[next].trim()) next += 1;
          if (next < lines.length && /^ {0,3}>/.test(lines[next])) {
            quoteLines.push("");
            index = next;
            continue;
          }
        }
        break;
      }
      output.push(`<blockquote>${renderBlocks(quoteLines, context, depth + 1)}</blockquote>`);
      continue;
    }

    // GFM tables: header row + separator row + body rows.
    if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
      const table = renderTable(lines.slice(index), context);
      output.push(table.html);
      index += table.nextIndex;
      continue;
    }

    // Lists (including nested and task lists).
    if (getListMarker(line)) {
      const list = renderList(lines, index, context, depth);
      output.push(list.html);
      index = Math.max(index + 1, list.nextIndex);
      continue;
    }

    // Indented code blocks.
    if (/^(?: {4}|\t)/.test(line)) {
      const codeLines: string[] = [];
      while (index < lines.length) {
        if (/^(?: {4}|\t)/.test(lines[index])) {
          codeLines.push(lines[index].replace(/^(?: {4}|\t)/, ""));
          index += 1;
        } else if (!lines[index].trim()) {
          codeLines.push("");
          index += 1;
        } else {
          break;
        }
      }
      while (codeLines.length && !codeLines[codeLines.length - 1]) codeLines.pop();
      output.push(`<pre class="my-3 overflow-x-auto rounded bg-black/25 p-4 font-mono text-xs border border-white/5"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // Raw HTML blocks are allowed by Markdown, but are sanitized by DOMPurify later.
    if (/^ {0,3}<(?:!--|\/?(?:address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|script|section|style|table|ul)\b)/i.test(line)) {
      const htmlLines: string[] = [];
      while (index < lines.length && lines[index].trim()) {
        htmlLines.push(lines[index]);
        index += 1;
      }
      output.push(htmlLines.join("\n"));
      continue;
    }

    // Paragraphs; two trailing spaces or a backslash create a hard line break.
    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      if (index + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1])) break;
      paragraphLines.push(lines[index]);
      index += 1;
    }

    if (paragraphLines.length === 0) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    let paragraphHtml = "";
    for (let lineIndex = 0; lineIndex < paragraphLines.length; lineIndex += 1) {
      const paragraphLine = paragraphLines[lineIndex];
      const hardBreak = /(?: {2,}|\\)$/.test(paragraphLine);
      const content = hardBreak ? paragraphLine.replace(/(?: {2,}|\\)$/, "") : paragraphLine;
      paragraphHtml += renderInline(content, context);
      if (lineIndex < paragraphLines.length - 1) paragraphHtml += hardBreak ? "<br />\n" : " ";
    }

    output.push(`<p>${paragraphHtml}</p>`);
  }

  return output.join("\n");
}

export function renderMarkdownToHtml(
  markdown: string,
  existingTitles: string[] = [],
  currentNoteTitle: string = ""
): string {
  if (!markdown) return "";

  const sourceLines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const references = new Map<string, MarkdownReference>();
  const footnotes = new Map<string, string>();
  const contentLines: string[] = [];

  // Collect Markdown reference links and simple footnote definitions, but
  // never interpret definition-looking text inside fenced code blocks.
  let activeFenceChar = "";
  let activeFenceLength = 0;
  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    const fenceMatch = isFence(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!activeFenceChar) {
        activeFenceChar = marker[0];
        activeFenceLength = marker.length;
      } else if (marker[0] === activeFenceChar && marker.length >= activeFenceLength && !fenceMatch[2].trim()) {
        activeFenceChar = "";
        activeFenceLength = 0;
      }
      contentLines.push(line);
      continue;
    }
    if (activeFenceChar) {
      contentLines.push(line);
      continue;
    }

    const referenceMatch = /^ {0,3}\[([^\]^]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+["'](.*?)["'])?\s*$/.exec(line);
    if (referenceMatch) {
      references.set(normalizeReferenceId(referenceMatch[1]), {
        url: referenceMatch[2] || referenceMatch[3],
        title: referenceMatch[4],
      });
      continue;
    }

    const footnoteMatch = /^ {0,3}\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
    if (footnoteMatch) {
      const footnoteId = footnoteMatch[1];
      const footnoteLines = [footnoteMatch[2]];
      let nextIndex = index + 1;
      while (nextIndex < sourceLines.length && (/^(?: {2,}|\t)/.test(sourceLines[nextIndex]) || !sourceLines[nextIndex].trim())) {
        if (!sourceLines[nextIndex].trim() && (nextIndex + 1 >= sourceLines.length || !/^(?: {2,}|\t)/.test(sourceLines[nextIndex + 1]))) break;
        footnoteLines.push(sourceLines[nextIndex].replace(/^(?: {2,}|\t)/, ""));
        nextIndex += 1;
      }
      footnotes.set(footnoteId, footnoteLines.join("\n").trim());
      index = nextIndex - 1;
      continue;
    }

    contentLines.push(line);
  }

  const context: MarkdownContext = {
    existingTitles,
    currentNoteTitle,
    references,
    footnotes,
    usedFootnotes: [],
  };

  let html = renderBlocks(contentLines, context);

  if (context.usedFootnotes.length > 0) {
    const footnoteItems = context.usedFootnotes.map((id) => {
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "-");
      const content = context.footnotes.get(id) || "";
      const backLink = `<a class="obsidian-footnote-backref" href="#footnote-ref-${escapeHtml(safeId)}" aria-label="返回註腳引用">↩</a>`;
      return `<li id="footnote-${escapeHtml(safeId)}">${renderInline(content, context)} ${backLink}</li>`;
    });

    html += `<section class="obsidian-footnotes"><hr /><ol>${footnoteItems.join("")}</ol></section>`;
  }

  return html;
}
