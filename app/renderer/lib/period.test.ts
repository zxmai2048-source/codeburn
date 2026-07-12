import { describe, expect, it } from 'vitest'

import type { DailyHistoryEntry, Period } from './types'
import { contiguousDailyWindow, formatChartDate, sliceDailyToPeriod } from './period'

function entry(date: string): DailyHistoryEntry {
  return {
    date,
    cost: 1,
    savingsUSD: 0,
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    topModels: [],
  }
}

const NOW = new Date(2026, 6, 10, 12, 0, 0)
const DAILY = [
  entry('2026-05-31'),
  entry('2026-06-01'),
  entry('2026-06-10'),
  entry('2026-06-11'),
  entry('2026-07-01'),
  entry('2026-07-03'),
  entry('2026-07-04'),
  entry('2026-07-09'),
  entry('2026-07-10'),
  entry('2026-07-11'),
]

describe('sliceDailyToPeriod', () => {
  it.each<[Period, string[]]>([
    ['today', ['2026-07-10']],
    ['week', ['2026-07-04', '2026-07-09', '2026-07-10']],
    ['30days', ['2026-06-11', '2026-07-01', '2026-07-03', '2026-07-04', '2026-07-09', '2026-07-10']],
    ['month', ['2026-07-01', '2026-07-03', '2026-07-04', '2026-07-09', '2026-07-10']],
    [
      'all',
      [
        '2026-05-31',
        '2026-06-01',
        '2026-06-10',
        '2026-06-11',
        '2026-07-01',
        '2026-07-03',
        '2026-07-04',
        '2026-07-09',
        '2026-07-10',
      ],
    ],
  ])('returns only in-window entries for %s', (period, expectedDates) => {
    expect(sliceDailyToPeriod(DAILY, period, NOW).map(day => day.date)).toEqual(expectedDates)
  })
})

describe('contiguousDailyWindow', () => {
  it('returns exactly the requested calendar days ending today and zero-fills gaps', () => {
    const window = contiguousDailyWindow(DAILY, 5, NOW)

    expect(window.map(day => day.date)).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
    ])
    expect(window[0]).toMatchObject({ cost: 0, calls: 0, topModels: [] })
    expect(window[3]).toBe(DAILY[7])
    expect(window[4]).toBe(DAILY[8])
  })
})

describe('formatChartDate', () => {
  it('formats date keys without shifting the local calendar day', () => {
    expect(formatChartDate('2026-07-01')).toBe('Jul 1')
  })
})
