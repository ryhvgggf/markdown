import { LINK_TOKEN_RE } from '@/core/extract/extract'
import { Highlighted } from './Highlighted'

const mark = (t: string, k: number) => (
  <mark key={k} data-link-kind="note" className="rounded-[4px] bg-link-note/12 px-0.5 text-link-note">
    {t}
  </mark>
)

/** Renders indexer snippets: link tokens become note titles (the open note highlighted). */
function Snippet({
  text,
  term,
  currentId,
  titleOf,
}: {
  text: string
  term: string
  currentId?: string
  titleOf?: (id: string) => string | undefined
}) {
  if (!currentId || !titleOf) return <Highlighted text={text} term={term} />
  const out: React.ReactNode[] = []
  let from = 0
  for (const m of text.matchAll(LINK_TOKEN_RE)) {
    const at = m.index
    if (at > from) out.push(text.slice(from, at))
    const id = m[1]
    const title = titleOf(id)
    if (title === undefined) {
      out.push(<span key={at} className="text-fg-tertiary">已刪除的筆記</span>)
    } else if (id === currentId) out.push(mark(title || '未命名', at))
    else
      out.push(
        <span key={at} data-link-kind="note" className="text-link-note">
          {title || '未命名'}
        </span>,
      )
    from = at + m[0].length
  }
  out.push(text.slice(from))
  return <>{out}</>
}

export const cardCls =
  'block w-full rounded-[12px] bg-surface p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition duration-200 ease-spring'

export function BacklinkCard({
  title,
  folderPath,
  snippet,
  term,
  currentId,
  titleOf,
  extra = 0,
  dashed = false,
  onClick,
  action,
}: {
  title: string
  folderPath: string
  snippet: string
  term: string
  currentId?: string
  titleOf?: (id: string) => string | undefined
  extra?: number
  dashed?: boolean
  onClick?: () => void
  action?: React.ReactNode
}) {
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-fg">{title || '未命名'}</span>
        {folderPath && <span className="shrink-0 text-xs text-fg-tertiary">{folderPath}</span>}
      </span>
      <span className="mt-1 line-clamp-3 block text-xs leading-relaxed text-fg-secondary">
        <Snippet text={snippet} term={term} currentId={currentId} titleOf={titleOf} />
      </span>
      {extra > 0 && <span className="mt-1 block text-xs text-fg-tertiary">另有 {extra} 處連結</span>}
    </>
  )
  const cls = `${cardCls} ${dashed ? 'border border-dashed border-fg-tertiary/50 !shadow-none bg-transparent' : ''}`
  return (
    <li className="list-none">
      {onClick ? (
        <button type="button" className={`${cls} hover:bg-fill`} onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className={cls}>
          {body}
          {action}
        </div>
      )}
    </li>
  )
}
