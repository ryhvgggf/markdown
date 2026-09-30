/**
 * Obsidian 雙向鏈結、標籤、多媒體與章節標題解析渲染器
 */

export interface ParsedLinksAndTags {
  outgoingLinks: string[];
  tags: string[];
  embeddedMedia: string[];
  headings: string[];
}

export function slugifyHeading(text: string): string {
  const clean = text.replace(/<[^>]+>/g, "").trim().toLowerCase();
  return "heading-" + encodeURIComponent(clean.replace(/\s+/g, "-"));
}

export function parseLinksAndTags(content: string): ParsedLinksAndTags {
  if (!content) {
    return { outgoingLinks: [], tags: [], embeddedMedia: [], headings: [] };
  }

  // 1. 忽略程式碼區塊中的內容
  const cleanContent = content
    .replace(/\`\`\`[\s\S]*?\`\`\`/g, "")
    .replace(/\`[^\n\`]+\`/g, "");

  // 2. 提取嵌入式媒體 ![[filename]]
  const embeddedMedia: string[] = [];
  const embedRegex = /!\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
  let embedMatch: RegExpExecArray | null;
  while ((embedMatch = embedRegex.exec(cleanContent)) !== null) {
    const rawMedia = embedMatch[1].trim();
    if (rawMedia && !embeddedMedia.includes(rawMedia)) {
      embeddedMedia.push(rawMedia);
    }
  }

  // 3. 提取 Obsidian 雙向鏈結 [[Note Title]] 或 [[Note Title#Heading]]
  const outgoingLinks: string[] = [];
  const withoutEmbeds = cleanContent.replace(/!\[\[[^\]]+\]\]/g, "");
  // 比對 [[Note#Heading|Alias]]
  const linkRegex = /\[\[([^\]|#]*)(?:#([^\]|#]+))?(?:\|([^\]]+))?\]\]/g;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRegex.exec(withoutEmbeds)) !== null) {
    const rawTarget = (linkMatch[1] || "").trim();
    if (rawTarget && !outgoingLinks.includes(rawTarget)) {
      outgoingLinks.push(rawTarget);
    }
  }

  // 4. 提取標籤 #tag
  const tags: string[] = [];
  const tagRegex = /(?:^|\s)#([a-zA-Z0-9_\u4e00-\u9fa5\-]+)(?=\s|$)/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(cleanContent)) !== null) {
    const tag = tagMatch[1].trim();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  // 5. 提取所有標題 (# ~ ######)
  const headings: string[] = [];
  const headingLineRegex = /^(?:#{1,6})\s+(.+)$/gm;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingLineRegex.exec(cleanContent)) !== null) {
    const headingText = hMatch[1].trim();
    if (headingText && !headings.includes(headingText)) {
      headings.push(headingText);
    }
  }

  return { outgoingLinks, tags, embeddedMedia, headings };
}

export function isVideoFile(filename: string): boolean {
  return /\.(mp4|webm|ogg|mov)$/i.test(filename);
}

export function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(filename);
}

/**
 * 完整 Markdown 轉 HTML 渲染器
 * 支援標題錨點 ID、[[Note#Heading]] 標題雙向跳轉
 */
export function renderMarkdownToHtml(
  markdown: string,
  existingTitles: string[] = [],
  currentNoteTitle: string = ""
): string {
  if (!markdown) return "";

  const lines = markdown.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let inList = false;

  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const processInline = (text: string) => {
    // 1. 嵌入多媒體語法 ![[filename.ext]]
    text = text.replace(/!\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, filename, alt) => {
      const cleanFile = filename.trim();
      const altText = (alt || cleanFile).trim();
      const isVid = isVideoFile(altText);
      return `<div class="obsidian-media-container my-3 rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 p-2 inline-block max-w-full" data-media-name="${escapeHtml(cleanFile)}" data-is-video="${isVid}">
        <span class="text-xs text-purple-400 flex items-center gap-1.5 font-mono">
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="3" stroke-dasharray="32" stroke-linecap="round"></circle></svg>
          載入附件: ${escapeHtml(altText)}
        </span>
      </div>`;
    });

    // 2. 一般圖片語法 ![alt](src)
    text = text.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, (_, alt, src) => {
      const isVid = isVideoFile(src);
      if (isVid) {
        return `<video controls class="rounded-2xl max-h-96 max-w-full my-3 border border-slate-800" src="${escapeHtml(src)}">${escapeHtml(alt)}</video>`;
      }
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" class="rounded-2xl max-h-96 max-w-full my-3 object-contain border border-slate-800" />`;
    });

    // 3. 雙向連結 [[Note]] 或 [[Note#Heading]] 或 [[#Heading]] 或 [[Note#Heading|Alias]]
    text = text.replace(/\[\[([^\]|#]*)(?:#([^\]|#]+))?(?:\|([^\]]+))?\]\]/g, (_, target, heading, alias) => {
      const cleanTarget = (target || "").trim();
      const cleanHeading = (heading || "").trim();
      const isLocalHeadingOnly = !cleanTarget && cleanHeading;
      const effectiveTargetTitle = cleanTarget || currentNoteTitle;

      let displayText = (alias || "").trim();
      if (!displayText) {
        if (isLocalHeadingOnly) {
          displayText = `#${cleanHeading}`;
        } else if (cleanHeading) {
          displayText = `${cleanTarget} > #${cleanHeading}`;
        } else {
          displayText = cleanTarget;
        }
      }

      const exists = isLocalHeadingOnly || existingTitles.some(t => t.toLowerCase() === effectiveTargetTitle.toLowerCase());
      const stateClass = exists
        ? "text-purple-400 hover:text-purple-300 hover:underline font-medium"
        : "text-purple-400/60 hover:text-purple-300/80 border-b border-dashed border-purple-500/50";

      const headingSlug = cleanHeading ? slugifyHeading(cleanHeading) : "";

      return `<a href="#" class="obsidian-wikilink inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-950/40 cursor-pointer ${stateClass} transition shadow-xs" data-note-title="${escapeHtml(effectiveTargetTitle)}" data-heading-target="${escapeHtml(cleanHeading)}" data-heading-slug="${escapeHtml(headingSlug)}">${escapeHtml(displayText)}</a>`;
    });

    // 4. 標籤 #tag
    text = text.replace(/(^|\s)#([a-zA-Z0-9_\u4e00-\u9fa5\-]+)(?=\s|$)/g, (_, space, tag) => {
      return `${space}<span class="obsidian-tag inline-block px-2 py-0.5 rounded-full text-[11px] bg-slate-800 text-purple-300 font-mono cursor-pointer hover:bg-slate-700 transition" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`;
    });

    // 5. 粗體、斜體、行內代碼、刪除線
    text = text.replace(/\`([^\`]+)\`/g, '<code class="rounded bg-slate-800 px-1 py-0.5 font-mono text-xs text-purple-200">$1</code>');
    text = text.replace(/\*\*([^\*]+)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
    text = text.replace(/\*([^\*]+)\*/g, '<em class="italic text-slate-300">$1</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del class="line-through text-slate-500">$1</del>');

    // 6. 一般超連結 [title](url)
    text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline hover:text-blue-300">$1</a>');

    return text;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        result.push(`<pre class="my-3 overflow-x-auto rounded-2xl bg-slate-900 p-4 font-mono text-xs text-slate-300 border border-slate-800"><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    if (!line.trim().startsWith('- ') && !line.trim().startsWith('* ') && inList) {
      result.push('</ul>');
      inList = false;
    }

    if (!line.trim()) {
      result.push('<div class="h-3"></div>');
      continue;
    }

    // 標題 # ~ ###### (自動注入唯一 ID 錨點與過渡高亮 class)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const rawHeadingText = headingMatch[2].trim();
      const headingSlug = slugifyHeading(rawHeadingText);
      const text = processInline(rawHeadingText);

      const headingClasses: Record<number, string> = {
        1: 'text-2xl font-black text-white mt-6 mb-3 border-b border-slate-800 pb-2 scroll-mt-6 transition-all duration-500 rounded-lg p-1',
        2: 'text-xl font-bold text-white mt-5 mb-2.5 border-b border-slate-800/60 pb-1 scroll-mt-6 transition-all duration-500 rounded-lg p-1',
        3: 'text-lg font-bold text-purple-200 mt-4 mb-2 scroll-mt-6 transition-all duration-500 rounded-lg p-1',
        4: 'text-base font-semibold text-slate-200 mt-3 mb-1.5 scroll-mt-6 transition-all duration-500 rounded-lg p-1',
        5: 'text-sm font-semibold text-slate-300 mt-2 mb-1 scroll-mt-6 transition-all duration-500 rounded-lg p-1',
        6: 'text-xs font-semibold text-slate-400 mt-2 mb-1 uppercase tracking-wider scroll-mt-6 transition-all duration-500 rounded-lg p-1',
      };

      result.push(`<h${level} id="${headingSlug}" data-heading-text="${escapeHtml(rawHeadingText)}" class="obsidian-heading ${headingClasses[level]}">${text}</h${level}>`);
      continue;
    }

    // 引用區塊 >
    if (line.startsWith('> ')) {
      result.push(`<blockquote class="my-2 border-l-4 border-purple-500/80 bg-slate-900/60 px-4 py-2 italic text-slate-300 rounded-r-2xl">${processInline(line.slice(2))}</blockquote>`);
      continue;
    }

    // 待辦項目
    const todoMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (todoMatch) {
      const checked = todoMatch[1].toLowerCase() === 'x';
      result.push(`<div class="flex items-center gap-2.5 my-1.5 text-sm">
        <input type="checkbox" ${checked ? 'checked' : ''} disabled class="w-4 h-4 rounded-md border-slate-700 bg-slate-900 text-purple-600 focus:ring-0 cursor-default" />
        <span class="${checked ? 'line-through text-slate-500' : 'text-slate-200'}">${processInline(todoMatch[2])}</span>
      </div>`);
      continue;
    }

    // 清單
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) {
        result.push('<ul class="list-disc list-inside space-y-1 my-2 text-slate-300 text-sm">');
        inList = true;
      }
      result.push(`<li class="leading-relaxed">${processInline(line.slice(2))}</li>`);
      continue;
    }

    if (/^(\-{3,}|\*{3,})$/.test(line.trim())) {
      result.push('<hr class="my-6 border-slate-800" />');
      continue;
    }

    result.push(`<p class="my-1.5 text-sm leading-relaxed text-slate-200">${processInline(line)}</p>`);
  }

  if (inList) {
    result.push('</ul>');
  }

  return result.join('\n');
}

export function extractOutlinks(content: string): string[] {
  return parseLinksAndTags(content).outgoingLinks;
}

export function extractTags(content: string): string[] {
  return parseLinksAndTags(content).tags;
}
