import { useId, type ReactNode } from 'react'

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 text-xs font-medium tracking-wide text-fg-tertiary">{children}</h3>
}

/** Label on the left, control on the right; no dividers. */
export function Row({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1.5">
      <span id={id} className="text-base text-fg">
        {label}
      </span>
      {children}
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  const name = useId()
  const labelId = useId()
  return (
    <Row label={label} id={labelId}>
      <div role="radiogroup" aria-labelledby={labelId} className="inline-flex rounded-control bg-fill p-0.5">
        {options.map((o) => (
          <label key={o.value} className="relative">
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="block cursor-pointer rounded-[6px] px-3 py-1 text-sm text-fg-secondary transition duration-200 ease-spring peer-checked:bg-white peer-checked:font-medium peer-checked:text-fg peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </Row>
  )
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
}) {
  const id = useId()
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-base text-fg">
          {label}
        </label>
        <output htmlFor={id} className="text-sm text-fg-secondary tabular-nums">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-5 w-full cursor-pointer accent-[var(--accent)]"
      />
    </div>
  )
}
