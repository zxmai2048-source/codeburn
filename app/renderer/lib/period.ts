import type { DailyHistoryEntry, Period } from './types'

/** Local calendar date key "YYYY-MM-DD", matching the CLI's `dateKey` (src/day-aggregator.ts). */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Shared period-window helper for backfilled `history.daily` arrays. T8 should
 * migrate Overview.tsx to this helper so both sections use one source of truth.
 */
export function periodWindowStart(period: Period, now = new Date()): string | null {
  switch (period) {
    case 'today':
      return localDateKey(now)
    case 'week':
      return localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
    case '30days':
      return localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29))
    case 'month':
      return localDateKey(new Date(now.getFullYear(), now.getMonth(), 1))
    case 'all':
      return null
  }
}

/** `history.daily` entries within the selected period's date window. */
export function sliceDailyToPeriod(daily: DailyHistoryEntry[], period: Period, now = new Date()): DailyHistoryEntry[] {
  const start = periodWindowStart(period, now)
  const todayKey = localDateKey(now)
  return daily.filter(d => (start === null || d.date >= start) && d.date <= todayKey)
}

/** A contiguous calendar-day window ending today, with missing days zero-filled. */
export function contiguousDailyWindow(
  daily: DailyHistoryEntry[],
  days: number,
  now = new Date(),
): DailyHistoryEntry[] {
  const byDate = new Map(daily.map(day => [day.date, day]))
  const window: DailyHistoryEntry[] = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    const key = localDateKey(date)
    window.push(byDate.get(key) ?? {
      date: key,
      cost: 0,
      calls: 0,
      savingsUSD: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      topModels: [],
    })
  }
  return window
}

/** Format a local date key for compact chart-axis labels such as "Jul 1". */
export function formatChartDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleString('en-US', { month: 'short', day: 'numeric' })
}
