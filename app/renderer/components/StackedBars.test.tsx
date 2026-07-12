// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DailyHistoryEntry } from '../lib/types'
import { StackedBars } from './StackedBars'

function entry(day: number): DailyHistoryEntry {
  return {
    date: `2026-07-${String(day).padStart(2, '0')}`,
    cost: day,
    savingsUSD: 0,
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    topModels: [],
  }
}

describe('StackedBars', () => {
  it('renders every supplied day and axis ticks every fourth day plus the last', () => {
    const daily = Array.from({ length: 16 }, (_, index) => entry(index + 1))
    const { container } = render(<StackedBars daily={daily} />)

    expect(container.querySelectorAll('.sbars .c')).toHaveLength(16)
    const ticks = container.querySelectorAll('.sbars-wrap > .ov-xax span')
    expect([...ticks].map(tick => tick.textContent)).toEqual(['Jul 1', 'Jul 5', 'Jul 9', 'Jul 13', 'Jul 16'])
  })
})
