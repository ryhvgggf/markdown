import { useEffect, useReducer } from 'react'
import { useServices } from '@/app/services-context'
import type { MirrorService } from '@/app/mirror-service'

/** The mirror service, re-rendering on every status / progress change. */
export function useMirror(): MirrorService | undefined {
  const { mirror } = useServices()
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => mirror?.subscribe(bump), [mirror])
  return mirror
}
