import type katexType from 'katex'

type Katex = typeof katexType

let loading: Promise<Katex> | null = null

/** KaTeX and its stylesheet: a chunk of their own, loaded the first time a formula is shown. */
export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default)
  loading.catch(() => {
    loading = null // a failed chunk load (offline) is retried next time
  })
  return loading
}

/**
 * Renders `latex` into `el`. Formulas may come from someone else (a share link), so KaTeX runs with `trust` off
 * (no `\href`, `\url`, `\html…`) and with size / macro-expansion limits. Returns false when the formula has an
 * error; `el` then shows the formula's text.
 */
export function renderMath(katex: Katex, latex: string, el: HTMLElement, displayMode: boolean): boolean {
  try {
    katex.render(latex, el, { displayMode, throwOnError: true, trust: false, strict: 'ignore', maxSize: 100, maxExpand: 1000, output: 'htmlAndMathml' })
    return true
  } catch {
    el.textContent = latex
    return false
  }
}
