import type { CliError } from '../lib/types'

/**
 * One-line notice shown when a section still has last-good data but the latest
 * background poll failed. Muted so it never competes with the data below it.
 */
export function StaleBanner({ error }: { error: CliError }) {
  return (
    <div
      role="status"
      className="stale-banner"
      style={{
        fontSize: 11.5,
        color: 'var(--mut)',
        borderLeft: '2px solid var(--warn)',
        padding: '3px 8px',
        margin: '0 0 8px',
        lineHeight: 1.4,
      }}
    >
      Refresh failed, showing last good data · {error.message}
    </div>
  )
}
