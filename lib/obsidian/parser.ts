/**
 * Markdown / Wikilink / Tag / Media parser
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
    return {
      outgoingLinks: [],
      tags: [],
      embeddedMedia: [],
      headings: [],
    };
  }

  const cleanContent = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^\n`]+`/g, "");

  const embeddedMedia: string[] = [];
  const embedRegex = /!\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;

  let embedMatch: RegExpExecArray | null;

  while ((embedMatch = embedRegex.exec(cleanContent)) !== null) {
    const ref = embedMatch[1].trim();

    if (ref && !embeddedMedia.includes(ref)) {
      embeddedMedia.push(ref);
    }
  }

  const outgoingLinks: string[] = [];
  const withoutEmbeds = cleanContent.replace(/!\[\[[^\]]+\]\]/g, "");
  const linkRegex =
    /\[\[([^\]|#]*)(?:#([^\]|#]+))?(?:\|([^\]]+))?\]\]/g;

  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRegex.exec(withoutEmbeds)) !== null) {
    const target = (linkMatch[1] || "").trim();

    if (target && !outgoingLinks.includes(target)) {
      outgoingLinks.push(target);
    }
  }

  const tags: string[] = [];
  const tagRegex =
    /(?:^|\s)#([a-zA-Z0-9_\u4e00-\u9fa5\-]+)(?=\s|$)/g;

  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(cleanContent)) !== null) {
    const tag = tagMatch[1].trim();

    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  const headings: string[] = [];
  const headingRegex = /^(?:#{1,6})\s+(.+)$/gm;

  let headingMatch: RegExpExecArray | null;

  while ((headingMatch = headingRegex.exec(cleanContent)) !== null) {
    const heading = headingMatch[1].trim();

    if (heading && !headings.includes(heading)) {
      headings.push(heading);
    }
  }

  return {
    outgoingLinks,
    tags,
    embeddedMedia,
    headings,
  };
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

export function isVideoFile(filename: string): boolean {
  return /\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(filename);
}

export function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(filename);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getFileType(filename: string): string {
  const lower = filename.toLowerCase();

  if (/\.(jpg|jpeg|png|gif|webp|svg|avif|ico|bmp)$/i.test(lower)) {
    return "image";
  }

  if (/\.(mp4|webm|ogg|mov|mkv|avi|m4v)$/i.test(lower)) {
    return "video";
  }

  if (/\.(mp3|wav|ogg|m4a|flac|aac|wma)$/i.test(lower)) {
    return "audio";
  }

  if (/\.pdf$/i.test(lower)) return "pdf";
  if (/\.(xlsx?|csv|numbers)$/i.test(lower)) return "excel";
  if (/\.(docx?|pages|rtf)$/i.test(lower)) return "doc";
  if (/\.(pptx?|keynote)$/i.test(lower)) return "ppt";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lower)) return "archive";
  if (/\.(txt|md|json|js|ts|tsx|jsx|py|html|css|xml|yaml|yml)$/i.test(lower)) {
    return "text";
  }

  return "file";
}

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
  let inOrderedList = false;

  const processInline = (text: string) => {
    /* 媒體：![[media-id|filename.ext]] 或舊版 ![[filename.ext]] */
    text = text.replace(
      /!\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g,
      (_match, ref, label) => {
        const cleanRef = String(ref || "").trim();
        const displayName = String(label || cleanRef).trim();
        const fileType = getFileType(displayName || cleanRef);

        return `<div
          class="obsidian-media-container my-3 inline-block max-w-full overflow-hidden"
          data-media-id="${escapeHtml(cleanRef)}"
          data-media-name="${escapeHtml(displayName)}"
          data-media-type="${escapeHtml(fileType)}"
        >
          <span class="text-xs text-slate-400 font-mono">載入檔案：${escapeHtml(
            displayName
          )}</span>
        </div>`;
      }
    );

    /* 一般 Markdown 圖片 */
    text = text.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_match, alt, src) => {
        const safeAlt = escapeHtml(String(alt || ""));
        const safeSrc = escapeHtml(String(src || ""));

        if (isVideoFile(String(src || ""))) {
          return `<video controls class="rounded max-h-96 max-w-full my-3 border border-white/10" src="${safeSrc}">${safeAlt}</video>`;
        }

        return `<img src="${safeSrc}" alt="${safeAlt}" class="rounded max-h-96 max-w-full my-3 object-contain border border-white/10" />`;
      }
    );

    /* Wikilink */
    text = text.replace(
      /\[\[([^\]|#]*)(?:#([^\]|#]+))?(?:\|([^\]]+))?\]\]/g,
      (_match, target, heading, alias) => {
        const cleanTarget = String(target || "").trim();
        const cleanHeading = String(heading || "").trim();
        const cleanAlias = String(alias || "").trim();

        const isLocalHeadingOnly = !cleanTarget && !!cleanHeading;
        const effectiveTitle = cleanTarget || currentNoteTitle;

        let displayText = cleanAlias;

        if (!displayText) {
          if (isLocalHeadingOnly) {
            displayText = `#${cleanHeading}`;
          } else if (cleanHeading) {
            displayText = `${cleanTarget} > #${cleanHeading}`;
          } else {
            displayText = cleanTarget;
          }
        }

        const exists =
          isLocalHeadingOnly ||
          existingTitles.some(
            (title) =>
              title.trim().toLowerCase() ===
              effectiveTitle.trim().toLowerCase()
          );

        const headingSlug = cleanHeading
          ? slugifyHeading(cleanHeading)
          : "";

        const stateClass = exists
          ? "text-cyan-300"
          : "text-cyan-300/60 border-b border-dashed border-cyan-600/40";

        return `<a
          href="#"
          class="obsidian-wikilink ${stateClass}"
          data-note-title="${escapeHtml(effectiveTitle)}"
          data-heading-target="${escapeHtml(cleanHeading)}"
          data-heading-slug="${escapeHtml(headingSlug)}"
        >${escapeHtml(displayText)}</a>`;
      }
    );

    /* Tag */
    text = text.replace(
      /(^|\s)#([a-zA-Z0-9_\u4e00-\u9fa5\-]+)(?=\s|$)/g,
      (_match, space, tag) =>
        `${space}<span class="obsidian-tag" data-tag="${escapeHtml(
          tag
        )}">#${escapeHtml(tag)}</span>`
    );

    /* Inline code first */
    text = text.replace(
      /`([^`]+)`/g,
      '<code class="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">$1</code>'
    );

    text = text.replace(
      /\*\*([^*]+)\*\*/g,
      '<strong class="font-bold text-white">$1</strong>'
    );

    text = text.replace(
      /\*([^*]+)\*/g,
      '<em class="italic text-slate-300">$1</em>'
    );

    text = text.replace(
      /~~([^~]+)~~/g,
      '<del class="line-through text-slate-500">$1</del>'
    );

    text = text.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-cyan-300 underline">$1</a>'
    );

    return text;
  };

  const closeLists = () => {
    if (inList) {
      result.push("</ul>");
      inList = false;
    }

    if (inOrderedList) {
      result.push("</ol>");
      inOrderedList = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      closeLists();

      if (inCodeBlock) {
        result.push(
          `<pre class="my-3 overflow-x-auto rounded bg-black/25 p-4 font-mono text-xs border border-white/5"><code>${escapeHtml(
            codeBlockContent.join("\n")
          )}</code></pre>`
        );

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

    if (!trimmed) {
      closeLists();
      result.push('<div class="h-3"></div>');
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);

    if (headingMatch) {
      closeLists();

      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      const slug = slugifyHeading(headingText);

      result.push(
        `<h${level} id="${escapeHtml(
          slug
        )}" data-heading-slug="${escapeHtml(slug)}">${processInline(
          headingText
        )}</h${level}>`
      );

      continue;
    }

    if (/^>\s?/.test(line)) {
      closeLists();
      result.push(
        `<blockquote>${processInline(line.replace(/^>\s?/, ""))}</blockquote>`
      );
      continue;
    }

    const unorderedMatch = /^[-*]\s+(.+)$/.exec(trimmed);

    if (unorderedMatch) {
      if (inOrderedList) {
        result.push("</ol>");
        inOrderedList = false;
      }

      if (!inList) {
        result.push("<ul>");
        inList = true;
      }

      result.push(`<li>${processInline(unorderedMatch[1])}</li>`);
      continue;
    }

    const orderedMatch = /^\d+\.\s+(.+)$/.exec(trimmed);

    if (orderedMatch) {
      if (inList) {
        result.push("</ul>");
        inList = false;
      }

      if (!inOrderedList) {
        result.push("<ol>");
        inOrderedList = true;
      }

      result.push(`<li>${processInline(orderedMatch[1])}</li>`);
      continue;
    }

    closeLists();
    result.push(`<p>${processInline(line)}</p>`);
  }

  closeLists();

  if (inCodeBlock && codeBlockContent.length > 0) {
    result.push(
      `<pre class="my-3 overflow-x-auto rounded bg-black/25 p-4 font-mono text-xs border border-white/5"><code>${escapeHtml(
        codeBlockContent.join("\n")
      )}</code></pre>`
    );
  }

  return result.join("\n");
}
