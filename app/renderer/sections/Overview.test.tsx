// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload } from '../lib/types'
import { Overview, localDateKey } from './Overview'

// Mock the typed bridge so the section fetches our payload instead of spawning
// the CLI. `normalizeCliError` (used by usePolled) is kept from the real module.
// `vi.hoisted` lets the hoisted `vi.mock` factory reference the spy safely.
const { getOverview } = vi.hoisted(() => ({
  getOverview: vi.fn<(period: string, provider: string) => Promise<MenubarPayload>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, codeburn: { getOverview } }
})

/** A fully-typed payload anchored to `now` so today/MTD/projected are stable. */
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
      topModels: [],
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
  })

  it("renders today's spend, a session title, and a highlighted capsule chart", async () => {
    const now = new Date()
    getOverview.mockResolvedValue(makePayload(now))

    const { container } = render(<Overview period="30days" provider="all" />)

    // Today card value comes from today's history.daily entry ($6.20).
    expect(await screen.findByText('$6.20')).toBeInTheDocument()

    // Session row title = the session's project (topSessions has no title field).
    expect(screen.getByText('parser-service')).toBeInTheDocument()

    // One capsule bar per daily entry, with peak + runner-up highlighted.
    expect(container.querySelectorAll('.bars .c')).toHaveLength(30)
    expect(container.querySelector('.c.hi')).not.toBeNull()
    expect(container.querySelector('.c.hi2')).not.toBeNull()
  })

  it('shows the first-run locate-CLI state when the binary is missing', async () => {
    getOverview.mockRejectedValue({ kind: 'not-found', message: 'codeburn not found' })

    render(<Overview period="30days" provider="all" />)

    expect(await screen.findByText(/Locate the codeburn CLI/i)).toBeInTheDocument()
  })
})
