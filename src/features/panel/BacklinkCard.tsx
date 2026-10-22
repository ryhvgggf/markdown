import { Highlighted } from './Highlighted'

export const cardCls =
  'block w-full rounded-[12px] bg-surface p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition duration-200 ease-spring'

export function BacklinkCard({
  title,
  folderPath,
  snippet,
  term,
  extra = 0,
  dashed = false,
  onClick,
  action,
}: {
  title: string
  folderPath: string
  snippet: string
  term: string
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
        <Highlighted text={snippet} term={term} />
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
