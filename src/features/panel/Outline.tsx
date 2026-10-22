import { useOutline } from './use-outline'

const INDENT = { 1: 0, 2: 12, 3: 24 } as const

export function Outline({ noteId }: { noteId: string }) {
  const { items, activeId, select } = useOutline(noteId)
  if (items.length === 0) {
    return <p className="mt-6 px-4 text-center text-sm text-fg-tertiary">這篇筆記還沒有標題</p>
  }
  return (
    <nav aria-label="大綱" className="px-2 pb-4">
      <ul className="flex flex-col gap-0.5">
        {items.map((it) => {
          const active = it.id === activeId
          return (
            <li key={it.id} style={{ paddingLeft: INDENT[it.level] }}>
              <button
                type="button"
                aria-current={active ? 'location' : undefined}
                className={`w-full truncate rounded-control px-2 py-1.5 text-left text-sm hover:bg-fill ${
                  active ? 'font-medium text-accent' : it.level === 1 ? 'text-fg' : 'text-fg-secondary'
                }`}
                onClick={() => select(it.id)}
              >
                {it.text}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
