// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActReportJson, MenubarPayload, StatusJson } from '../lib/types'
import { Overview, localDateKey } from './Overview'

// Mock the typed bridge so the section fetches our payload instead of spawning
// the CLI. `normalizeCliError` (used by usePolled) is kept from the real module.
// `vi.hoisted` lets the hoisted `vi.mock` factory reference the spy safely.
const { getOverview, getPlans, getActReport } = vi.hoisted(() => ({
  getOverview: vi.fn<(period: string, provider: string) => Promise<MenubarPayload>>(),
  getPlans: vi.fn<(period: string) => Promise<StatusJson>>(),
  getActReport: vi.fn<() => Promise<ActReportJson>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, codeburn: { getOverview, getPlans, getActReport } }
})

/**
 * A fully-typed payload anchored to `now` so today/MTD/projected are stable.
 * `history.daily` deliberately spans 30 backfill days (the real CLI emits up to
 * 365 regardless of period) so tests can prove the chart is sliced to the
 * selected period window.
 */
function makePayload(now: Date): MenubarPayload {
  const DAYS = 30
  // 30 daily entries ending today. Base $5, a clear peak ($32) and runner-up
  // ($28), and today's entry (last) at $6.20 — the Today card's source value.
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1 - i))
    let cost = 5
    if (i === 10) cost = 32 // peak → .c.hi
    else if (i === 20) cost = 28 // runner-up → .c.hi2
    else if (i === DAYS - 1) cost = 6.2 // today
    return {
      date: localDateKey(d),
      cost,
      savingsUSD: 0,
      calls: 40,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      topModels: [{ name: 'claude-opus-4', cost, savingsUSD: 0, calls: 40, inputTokens: 0, outputTokens: 0 }],
    }
  })

  return {
    generated: now.toISOString(),
    current: {
      label: 'Last 30 days',
      cost: 312.4,
      calls: 4200,
      sessions: 88,
      oneShotRate: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitPercent: 0,
      codexCredits: 0,
      topActivities: [],
      topModels: [{ name: 'claude-opus-4', cost: 200, savingsUSD: 0, savingsBaselineModel: '', calls: 100 }],
      localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
      providers: {},
      topProjects: [
        {
          name: 'parser-service',
          cost: 8.41,
          savingsUSD: 0,
          sessions: 1,
          avgCostPerSession: 8.41,
          sessionDetails: [
            {
              cost: 8.41,
              savingsUSD: 0,
              calls: 41,
              inputTokens: 0,
              outputTokens: 0,
              date: '2026-07-08',
              models: [{ name: 'claude-opus-4', cost: 8.41, savingsUSD: 0 }],
            },
          ],
        },
      ],
      modelEfficiency: [],
      topSessions: [
        { project: 'parser-service', cost: 8.41, savingsUSD: 0, calls: 41, date: '2026-07-08' },
        { project: 'pairing-svc', cost: 6.12, savingsUSD: 0, calls: 33, date: '2026-07-07' },
      ],
      retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
      routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
      tools: [],
      skills: [],
      subagents: [],
      mcpServers: [],
    },
    optimize: { findingCount: 3, savingsUSD: 23.6, topFindings: [] },
    history: { daily },
  }
}

describe('Overview', () => {
  beforeEach(() => {
    getOverview.mockReset()
    getPlans.mockReset()
    getActReport.mockReset()
    getPlans.mockResolvedValue({
      currency: 'USD',
      today: { cost: 0, savings: 0, calls: 0 },
      month: { cost: 0, savings: 0, calls: 0 },
      plan: {
        id: 'claude-pro', provider: 'claude', budget: 100, spent: 82, percentUsed: 82,
        status: 'near', projectedMonthEnd: 120, daysUntilReset: 4,
        periodStart: '2026-07-01', periodEnd: '2026-08-01',
      },
    })
    getActReport.mockResolvedValue({ totals: { realizedCostUSD: 84.2, measuredActions: 11 } })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders real hero, plan, saved, session, and daily-chart data", async () => {
    const now = new Date()
    getOverview.mockResolvedValue(makePayload(now))

    const { container } = render(<Overview period="30days" provider="all" />)

    // Today card value comes from today's history.daily entry ($6.20).
    expect(await screen.findByText('$6.20')).toBeInTheDocument()
    expect(container.querySelector('.ov-streak')).toHaveTextContent('30-day streak')

    // Session row title = the session's project (topSessions has no title field).
    expect(screen.getByText('parser-service')).toBeInTheDocument()

    // The selected range produces one real bar per day and only its peak is highlighted.
    const bars = container.querySelectorAll('.chart .col')
    expect(bars).toHaveLength(30)
    expect(bars[10].classList.contains('hi')).toBe(true)
    expect(container.querySelectorAll('.chart .col.hi')).toHaveLength(1)
    expect(bars[29]).toHaveAttribute('data-cost', '6.2')
    expect(bars[29]).toHaveAttribute('data-calls', '40')
    expect(bars[29]).toHaveAttribute('data-led', 'claude-opus-4')
    fireEvent.mouseEnter(bars[29], { clientX: 100, clientY: 80 })
    expect(screen.getByText('40 calls · claude-opus-4 led')).toBeInTheDocument()

    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText('$84.20')).toBeInTheDocument()
    expect(screen.getByText('from 11 applied fixes')).toBeInTheDocument()
  })

  it('uses honest empty states when no budget or realized savings exist', async () => {
    const now = new Date()
    getOverview.mockResolvedValue(makePayload(now))
    getPlans.mockResolvedValue({
      currency: 'USD',
      today: { cost: 0, savings: 0, calls: 0 },
      month: { cost: 0, savings: 0, calls: 0 },
    })
    getActReport.mockResolvedValue({ totals: { realizedCostUSD: 0, measuredActions: 7 } })

    render(<Overview period="30days" provider="all" />)

    expect(await screen.findByText('No budget set')).toBeInTheDocument()
    await waitFor(() => expect(getActReport).toHaveBeenCalled())
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.getByText('from 0 applied fixes')).toBeInTheDocument()
  })

  it('slices the capsule chart to the selected period window', async () => {
    const now = new Date()
    getOverview.mockResolvedValue(makePayload(now))

    // period="week" → last 7 calendar days. The other 23 backfill entries are
    // outside the window and must be excluded from the chart.
    const { container } = render(<Overview period="week" provider="all" />)

    expect(await screen.findByText('parser-service')).toBeInTheDocument()
    expect(container.querySelectorAll('.chart .col')).toHaveLength(7)
  })

  it('computes month-to-date, projection, and previous-month pace', async () => {
    const now = new Date(2026, 6, 15, 12, 0, 0) // Wed Jul 15 2026, local
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const payload = makePayload(now)
    // Prepend three high-spend May days. The pace comparator must be the PREVIOUS
    // calendar month (June) only — averaging all prior months (incl. May) would
    // skew the % and mislabel it, which is the bug this guards.
    const mkMay = (date: string) => ({
      date,
      cost: 50,
      savingsUSD: 0,
      calls: 40,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      topModels: [],
    })
    payload.history.daily = [mkMay('2026-05-10'), mkMay('2026-05-11'), mkMay('2026-05-12'), ...payload.history.daily]
    getOverview.mockResolvedValue(payload)

    render(<Overview period="30days" provider="all" />)

    // MTD = sum of July daily costs = 13×$5 + $28 + $6.20 = $99.20.
    expect(await screen.findByText('$99.20')).toBeInTheDocument()
    // Projected = MTD + median(trailing-7 = $5) × 16 days left = $179.20.
    expect(screen.getByText('$179.20')).toBeInTheDocument()
    expect(screen.getByText('$80.00 to go')).toBeInTheDocument()
    // Pace compares July's daily avg (6.613) to the PREVIOUS calendar month's
    // (June: 14×$5 + $32 = $102 / 15 = 6.8) → -3%, and the label names June.
    expect(screen.getByText('-3% vs June pace')).toBeInTheDocument()
  })

  it('recovers a matched session model for the series dot and sub-line', async () => {
    const now = new Date()
    getOverview.mockResolvedValue(makePayload(now))

    const { container } = render(<Overview period="30days" provider="all" />)

    // parser-service session joins topProjects sessionDetails on
    // (project|date|calls|cost) → claude-opus-4 → blue dot + model in sub-line.
    expect(await screen.findByText('Jul 8 · claude-opus-4 · 41 calls')).toBeInTheDocument()
    const firstDot = container.querySelectorAll('.li')[0].querySelector('.mdot')
    expect(firstDot?.getAttribute('style')).toContain('var(--blue)')

    // pairing-svc has no matching project → neutral dot, model omitted from sub.
    expect(screen.getByText('Jul 7 · 33 calls')).toBeInTheDocument()
    const secondDot = container.querySelectorAll('.li')[1].querySelector('.mdot')
    expect(secondDot?.getAttribute('style')).toContain('var(--t3)')
  })

  it('disambiguates two same-project/same-day/same-calls sessions by cost', async () => {
    const now = new Date()
    const base = makePayload(now)
    // Two sessions identical on (project, date, calls) but differing in cost and
    // model. Without cost in the join key they collide; with it they resolve.
    const payload: MenubarPayload = {
      ...base,
      current: {
        ...base.current,
        topProjects: [
          {
            name: 'svc',
            cost: 12,
            savingsUSD: 0,
            sessions: 2,
            avgCostPerSession: 6,
            sessionDetails: [
              {
                cost: 10,
                savingsUSD: 0,
                calls: 20,
                inputTokens: 0,
                outputTokens: 0,
                date: '2026-07-08',
                models: [{ name: 'claude-opus-4', cost: 10, savingsUSD: 0 }],
              },
              {
                cost: 2,
                savingsUSD: 0,
                calls: 20,
                inputTokens: 0,
                outputTokens: 0,
                date: '2026-07-08',
                models: [{ name: 'claude-haiku-4', cost: 2, savingsUSD: 0 }],
              },
            ],
          },
        ],
        topSessions: [
          { project: 'svc', cost: 10, savingsUSD: 0, calls: 20, date: '2026-07-08' },
          { project: 'svc', cost: 2, savingsUSD: 0, calls: 20, date: '2026-07-08' },
        ],
      },
    }
    getOverview.mockResolvedValue(payload)

    const { container } = render(<Overview period="30days" provider="all" />)

    expect(await screen.findByText('Jul 8 · claude-opus-4 · 20 calls')).toBeInTheDocument()
    expect(screen.getByText('Jul 8 · claude-haiku-4 · 20 calls')).toBeInTheDocument()
    const dots = container.querySelectorAll('.li .mdot')
    expect(dots[0].getAttribute('style')).toContain('var(--blue)') // $10 → opus
    expect(dots[1].getAttribute('style')).toContain('var(--lav)') // $2 → haiku
  })

  it('shows the first-run locate-CLI state when the binary is missing', async () => {
    getOverview.mockRejectedValue({ kind: 'not-found', message: 'codeburn not found' })

    render(<Overview period="30days" provider="all" />)

    expect(await screen.findByText(/Locate the codeburn CLI/i)).toBeInTheDocument()
  })
})
