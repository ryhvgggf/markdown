import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

const SIGNALS: RegExp[] = [
  /^ {0,3}#{1,6}[ \t]+\S/m,
  /^ {0,3}[-*+][ \t]+\S/m,
  /^ {0,3}\d+[.)][ \t]+\S/m,
  /^ {0,3}```/m,
  /^ {0,3}>[ \t]?\S/m,
  /^ *\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/m,
  /\[[^\]\n]+\]\((https?:\/\/|mailto:)[^)\s]+\)/,
  /\*\*[^*\n]+\*\*/,
  /(^|[^\w`])`[^`\n]+`/,
  /~~[^~\n]+~~/,
]

/** Heuristic: does this plain text contain Markdown block / inline syntax worth converting? */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false
  return SIGNALS.some((re) => re.test(text))
}

/** markdown-it has no task lists: turn `[ ] ` / `[x] ` list items into Tiptap taskList markup. */
function convertTaskLists(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll('ul').forEach((ul) => {
    const items = Array.from(ul.children).filter((c): c is HTMLLIElement => c.tagName === 'LI')
    const marked = items.map((li) => {
      const holder = li.firstElementChild?.tagName === 'P' ? li.firstElementChild : li
      const first = holder.firstChild
      const m = first?.nodeType === Node.TEXT_NODE ? /^\[([ xX])\]\s+/.exec(first.textContent ?? '') : null
      return m ? { li, first: first as Text, m } : null
    })
    if (!items.length || marked.some((x) => !x)) return
    ul.setAttribute('data-type', 'taskList')
    marked.forEach((x) => {
      x!.first.textContent = (x!.first.textContent ?? '').slice(x!.m[0].length)
      x!.li.setAttribute('data-type', 'taskItem')
      x!.li.setAttribute('data-checked', x!.m[1] === ' ' ? 'false' : 'true')
    })
  })
  return tpl.innerHTML
}

export function markdownToHtml(src: string): string {
  const clean = DOMPurify.sanitize(md.render(src), { USE_PROFILES: { html: true } })
  return convertTaskLists(clean)
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste(view, event) {
            if (view.composing) return false
            const data = event.clipboardData
            if (!data || data.getData('text/html')) return false // Tiptap + schema filter HTML
            if (data.files?.length) return false
            const text = data.getData('text/plain')
            if (!looksLikeMarkdown(text)) return false
            const html = markdownToHtml(text)
            if (!html) return false
            event.preventDefault()
            return editor.commands.insertContent(html)
          },
        },
      }),
    ]
  },
})
