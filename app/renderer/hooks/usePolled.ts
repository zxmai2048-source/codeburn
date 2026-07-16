import { useCallback, useEffect, useRef, useState } from 'react'

import { normalizeCliError } from '../lib/ipc'
import type { CliError } from '../lib/types'

export type Polled<T> = {
  data: T | null
  error: CliError | null
  loading: boolean
  /** Wall-clock timestamp for the most recent successful fetch. */
  lastSuccessAt: number | null
  /** Re-run the fetcher immediately (period/provider change, manual refresh). */
  refresh: () => void
}

/**
 * Generic CLI-backed data hook: fetches on mount + whenever `deps` change, then
 * re-polls every `intervalMs`. Errors are normalized to the CliError shape so
 * sections can branch on `error.kind`. Last-good data is retained on error.
 *
 * `enabled` (default true) gates fetching: while false the hook stays in its
 * initial loading state and issues no CLI spawn. The app boot flow sets it false
 * on every section poll until the first overview resolves, so the one-time cold
 * cache hydration happens ONCE (via overview) instead of fanning out into a
 * parallel full-history parse per section.
 */
export function usePolled<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: { intervalMs?: number; enabled?: boolean } = {},
): Polled<T> {
  const intervalMs = opts.intervalMs ?? 30_000
  const enabled = opts.enabled ?? true
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<CliError | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  // Generation counter: every load() (mount, deps change, interval, refresh)
  // claims the next epoch; a fetch applies its result only while its epoch is
  // still current. This is what keeps a slow fetch from an older deps/period
  // from clobbering a newer one that already resolved.
  const epochRef = useRef(0)

  const load = useCallback(() => {
    if (!enabled) return
    const epoch = ++epochRef.current
    setLoading(true)
    // Clear any prior error at the start of each attempt so a fresh poll never
    // shows a stale banner while it is still in flight; last-good `data` stays.
    setError(null)
    fetcher()
      .then(result => {
        if (epochRef.current !== epoch) return
        setData(result)
        setError(null)
        setLastSuccessAt(Date.now())
      })
      .catch(err => {
        if (epochRef.current !== epoch) return
        setError(normalizeCliError(err))
      })
      .finally(() => {
        if (epochRef.current !== epoch) return
        setLoading(false)
      })
    // deps are intentionally the caller-provided dependency list; `enabled`
    // is prepended so flipping the gate re-creates load and fires immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  useEffect(() => {
    load()
    const id = setInterval(() => load(), intervalMs)
    return () => {
      clearInterval(id)
      // Retire this generation so an in-flight fetch can't resolve into state
      // after unmount or a deps change.
      epochRef.current++
    }
  }, [load, intervalMs])

  const refresh = useCallback(() => {
    load()
  }, [load])

  return { data, error, loading, lastSuccessAt, refresh }
}
