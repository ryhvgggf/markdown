/** Text with every case-insensitive occurrence of `term` wrapped in an accent mark. */
export function Highlighted({ text, term }: { text: string; term: string }) {
  const needle = term.trim().toLowerCase()
  if (!needle) return <>{text}</>
  const lower = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className="rounded-[4px] bg-accent/12 px-0.5 text-accent">
        {text.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
  }
  parts.push(text.slice(from))
  return <>{parts}</>
}
