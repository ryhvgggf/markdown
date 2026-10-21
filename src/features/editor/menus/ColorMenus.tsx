import type { Editor } from '@tiptap/core'
import { IconButton } from '@/ui/components/IconButton'
import { Menu } from '@/ui/components/Menu'
import { Highlighter, TextColor } from '@/ui/icons'
import { HIGHLIGHT_COLORS, TEXT_COLORS, type Swatch } from '../marks/formatting'

type Props = {
  editor: Editor
  active: boolean
  current?: string
  onOpenChange: (open: boolean) => void
}

function Swatches({ editor, colors, current, apply, reset }: {
  editor: Editor
  colors: Swatch[]
  current?: string
  apply: (value: string) => void
  reset: () => void
}) {
  const done = () => editor.commands.focus()
  return (
    <div className="p-1">
      <div className="grid grid-cols-6 gap-1.5 px-1 py-1" role="group">
        {colors.map((c) => (
          <Menu.Item
            key={c.value}
            aria-label={c.name}
            title={c.name}
            onSelect={() => {
              apply(c.value)
              done()
            }}
            className={`size-6 justify-center rounded-full border border-black/10 p-0 ${current === c.value ? 'ring-2 ring-accent ring-offset-1' : ''}`}
            style={{ background: c.value }}
          />
        ))}
      </div>
      <Menu.Separator />
      <Menu.Item
        onSelect={() => {
          reset()
          done()
        }}
      >
        預設
      </Menu.Item>
    </div>
  )
}

const keep = (e: Event) => e.preventDefault()

export function TextColorMenu({ editor, active, current, onOpenChange }: Props) {
  return (
    <Menu align="start" onOpenChange={onOpenChange} onCloseAutoFocus={keep} trigger={
      <IconButton label="文字顏色" aria-pressed={active} className={active ? 'bg-fill text-fg' : ''} onMouseDown={(e) => e.preventDefault()}>
        <TextColor size={16} />
      </IconButton>
    }>
      <Swatches
        editor={editor}
        colors={TEXT_COLORS}
        current={current}
        apply={(v) => editor.chain().setColor(v).run()}
        reset={() => editor.chain().unsetColor().run()}
      />
    </Menu>
  )
}

export function HighlightMenu({ editor, active, current, onOpenChange }: Props) {
  return (
    <Menu align="start" onOpenChange={onOpenChange} onCloseAutoFocus={keep} trigger={
      <IconButton label="螢光標記" aria-pressed={active} className={active ? 'bg-fill text-fg' : ''} onMouseDown={(e) => e.preventDefault()}>
        <Highlighter size={16} />
      </IconButton>
    }>
      <Swatches
        editor={editor}
        colors={HIGHLIGHT_COLORS}
        current={current}
        apply={(v) => editor.chain().setHighlight({ color: v }).run()}
        reset={() => editor.chain().unsetHighlight().run()}
      />
    </Menu>
  )
}
