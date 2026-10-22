import { useId } from 'react'
import { useServices } from '@/app/services-context'
import { usePrefs } from '@/app/use-prefs'
import { ACCENTS } from '@/core/preferences/accents'
import type { Prefs, Tri } from '@/core/preferences/preferences'
import { SectionLabel, Segmented, SliderRow, Row } from './controls'

export function ColorSection() {
  const { prefs } = useServices()
  const { accent } = usePrefs()
  const name = useId()
  const labelId = useId()
  return (
    <section aria-label="色彩">
      <SectionLabel>外觀</SectionLabel>
      <Row label="強調色" id={labelId}>
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap justify-end gap-3 p-1">
          {ACCENTS.map((a) => (
            <label key={a.id} title={a.name} className="relative">
              <input
                type="radio"
                name={name}
                aria-label={a.name}
                className="peer sr-only"
                checked={accent.toLowerCase() === a.hex.toLowerCase()}
                onChange={() => prefs.set({ accent: a.hex })}
              />
              <span
                className="block h-7 w-7 cursor-pointer rounded-full transition duration-200 ease-spring peer-checked:ring-2 peer-checked:ring-offset-2 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2"
                style={{ background: a.hex, ['--tw-ring-color' as string]: a.hex }}
              />
            </label>
          ))}
        </div>
      </Row>
    </section>
  )
}

export function TextSection() {
  const { prefs } = useServices()
  const p = usePrefs()
  return (
    <section aria-label="文字">
      <SectionLabel>編輯器</SectionLabel>
      <Segmented<Prefs['fontSize']> label="字級" value={p.fontSize} onChange={(v) => prefs.set({ fontSize: v })}
        options={[{ value: 'small', label: '小' }, { value: 'standard', label: '標準' }, { value: 'large', label: '大' }]} />
      <Segmented<Prefs['lineHeight']> label="行距" value={p.lineHeight} onChange={(v) => prefs.set({ lineHeight: v })}
        options={[{ value: 'compact', label: '緊湊' }, { value: 'standard', label: '標準' }, { value: 'relaxed', label: '寬鬆' }]} />
      <Segmented<Prefs['editorWidth']> label="編輯區寬度" value={p.editorWidth} onChange={(v) => prefs.set({ editorWidth: v })}
        options={[{ value: 'narrow', label: '窄' }, { value: 'standard', label: '標準' }, { value: 'wide', label: '寬' }]} />
    </section>
  )
}

export function LayoutSection() {
  const { prefs } = useServices()
  const p = usePrefs()
  return (
    <section aria-label="版面">
      <SectionLabel>版面配置</SectionLabel>
      <Segmented<Prefs['railMode']> label="工具列" value={p.railMode} onChange={(v) => prefs.set({ railMode: v })}
        options={[{ value: 'hover', label: '滑鼠移到左緣時顯示' }, { value: 'pinned', label: '固定顯示' }]} />
      <SliderRow label="側欄寬度" value={p.sidebarWidth} min={220} max={360} step={4} display={`${p.sidebarWidth} px`}
        onChange={(v) => prefs.set({ sidebarWidth: v })} />
    </section>
  )
}

const TRI: ReadonlyArray<{ value: Tri; label: string }> = [
  { value: 'system', label: '跟隨系統' },
  { value: 'on', label: '開啟' },
  { value: 'off', label: '關閉' },
]

export function MotionSection() {
  const { prefs } = useServices()
  const p = usePrefs()
  return (
    <section aria-label="動態">
      <SectionLabel>輔助功能</SectionLabel>
      <Segmented<Tri> label="減少動態效果" value={p.reduceMotion} options={TRI} onChange={(v) => prefs.set({ reduceMotion: v })} />
      <Segmented<Tri> label="減少透明度" value={p.reduceTransparency} options={TRI} onChange={(v) => prefs.set({ reduceTransparency: v })} />
    </section>
  )
}
