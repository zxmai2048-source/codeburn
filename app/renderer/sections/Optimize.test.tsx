// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload, YieldJsonReport } from '../lib/types'
import { Optimize, OptimizeContent } from './Optimize'

const { getOverview, getYield } = vi.hoisted(() => ({
  getOverview: vi.fn<(period: string, provider: string) => Promise<MenubarPayload>>(),
  getYield: vi.fn<(period: string) => Promise<YieldJsonReport>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, codeburn: { getOverview, getYield } }
})

function makePayload(): MenubarPayload {
  return {
    generated: '2026-07-10T19:00:00.000Z',
    current: {
      label: 'Last 30 days',
      cost: 612.48,
      calls: 1220,
      sessions: 88,
      oneShotRate: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitPercent: 0,
      codexCredits: 0,
      topActivities: [],
      topModels: [],
      localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
      providers: {},
      topProjects: [],
      modelEfficiency: [],
      topSessions: [],
      retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
      routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
      tools: [],
      skills: [],
      subagents: [],
      mcpServers: [],
    },
    optimize: {
      findingCount: 3,
      savingsUSD: 94.4,
      topFindings: [
        { title: 'Opus is doing your small talk', impact: 'high', savingsUSD: 9.1 },
        { title: 'Cache hit is low in agentseal-dash', impact: 'medium', savingsUSD: 8.7 },
        { title: 'Batch tiny requests', impact: 'low', savingsUSD: 2.4 },
      ],
    },
    history: { daily: [] },
  }
}

function makeYield(): YieldJsonReport {
  return {
    period: { label: 'Last 30 days', start: '2026-06-11', end: '2026-07-10' },
    summary: {
      productive: { costUSD: 440, sessions: 19, costPercent: 72, sessionPercent: 70 },
      reverted: { costUSD: 107, sessions: 4, costPercent: 17, sessionPercent: 15 },
      abandoned: { costUSD: 65.4, sessions: 3, costPercent: 11, sessionPercent: 15 },
      total: { costUSD: 612.4, sessions: 26 },
      productiveToRevertedCostRatio: 4.1,
    },
    details: [
      { sessionId: 'rev-1', project: 'codeburn', category: 'reverted', commitCount: 2, costUSD: 55 },
      { sessionId: 'rev-2', project: 'agentseal-dash', category: 'reverted', commitCount: 1, costUSD: 52 },
      { sessionId: 'abn-1', project: 'sandbox-spike', category: 'abandoned', commitCount: 0, costUSD: 65.4 },
      { sessionId: 'prod-1', project: 'desktop-app', category: 'productive', commitCount: 5, costUSD: 440 },
    ],
  }
}

function emptyPayload(): MenubarPayload {
  const payload = makePayload()
  payload.optimize = { findingCount: 0, savingsUSD: 0, topFindings: [] }
  return payload
}

function emptyYield(): YieldJsonReport {
  const report = makeYield()
  report.summary.reverted = { costUSD: 0, sessions: 0, costPercent: 0, sessionPercent: 0 }
  report.summary.abandoned = { costUSD: 0, sessions: 0, costPercent: 0, sessionPercent: 0 }
  report.details = []
  return report
}

describe('Optimize', () => {
  beforeEach(() => {
    getOverview.mockReset()
    getYield.mockReset()
  })

  it('renders waste findings with savings and segment totals from overview and yield payloads', async () => {
    getOverview.mockResolvedValue(makePayload())
    getYield.mockResolvedValue(makeYield())

    render(<Optimize period="30days" provider="all" />)

    expect(await screen.findByText('Opus is doing your small talk')).toBeInTheDocument()
    expect(screen.getByText('High')).toHaveClass('opt-impact-high')
    expect(screen.getByText('Medium')).toHaveClass('opt-impact-medium')
    expect(screen.getByText('Low')).toHaveClass('opt-impact-low')
    expect(screen.getByText('$9.10')).toBeInTheDocument()
    expect(screen.getByText('Cache hit is low in agentseal-dash')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Waste $94.40' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reverts $107.00' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abandoned $65.40' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fixes 3' })).toBeInTheDocument()
  })

  it('switches to Reverts and shows only reverted yield details', async () => {
    getOverview.mockResolvedValue(makePayload())
    getYield.mockResolvedValue(makeYield())

    render(<Optimize period="30days" provider="all" />)
    expect(await screen.findByText('Opus is doing your small talk')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reverts $107.00' }))

    expect(screen.getByText('codeburn')).toBeInTheDocument()
    expect(screen.getByText('2 commits · rev-1')).toBeInTheDocument()
    expect(screen.getByText('$55.00')).toBeInTheDocument()
    expect(screen.getByText('agentseal-dash')).toBeInTheDocument()
    expect(screen.queryByText('sandbox-spike')).not.toBeInTheDocument()
    expect(screen.queryByText('desktop-app')).not.toBeInTheDocument()
  })

  it('switches to Abandoned and shows only abandoned yield details', async () => {
    getOverview.mockResolvedValue(makePayload())
    getYield.mockResolvedValue(makeYield())

    render(<Optimize period="30days" provider="all" />)
    expect(await screen.findByText('Opus is doing your small talk')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abandoned $65.40' }))

    expect(screen.getByText('sandbox-spike')).toBeInTheDocument()
    expect(screen.getByText('0 commits · abn-1')).toBeInTheDocument()
    expect(screen.getByText('$65.40')).toHaveClass('val')
    expect(screen.getByText('$65.40')).not.toHaveClass('ok')
    expect(screen.queryByText('codeburn')).not.toBeInTheDocument()
    expect(screen.queryByText('agentseal-dash')).not.toBeInTheDocument()
    expect(screen.queryByText('desktop-app')).not.toBeInTheDocument()
  })

  it('renders an honest placeholder for unavailable yield totals and list bodies', async () => {
    getOverview.mockResolvedValue(makePayload())
    getYield.mockRejectedValue(new Error('yield failed'))

    render(<Optimize period="30days" provider="all" />)

    expect(await screen.findByRole('button', { name: 'Reverts —' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abandoned —' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reverts $0.00' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abandoned $0.00' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reverts —' }))
    expect(screen.getByText('—')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abandoned —' }))
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('switches to Fixes and shows populated and empty states', async () => {
    getOverview.mockResolvedValue(makePayload())
    getYield.mockResolvedValue(makeYield())

    const { rerender } = render(<Optimize period="30days" provider="all" />)
    expect(await screen.findByText('Opus is doing your small talk')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fixes 3' }))

    expect(screen.getByText('Opus is doing your small talk')).toBeInTheDocument()
    expect(screen.getByText('Cache hit is low in agentseal-dash')).toBeInTheDocument()
    expect(screen.getByText('High')).toHaveClass('opt-impact-high')
    expect(screen.getByText('$9.10')).toHaveClass('opt-finding-savings')

    getOverview.mockResolvedValue(emptyPayload())
    rerender(<Optimize period="week" provider="all" />)

    expect(await screen.findByText('No fixes in this range yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fixes 0' })).toBeInTheDocument()
  })

  it('renders honest empty states for missing optimize findings and yield details', async () => {
    getOverview.mockResolvedValue(emptyPayload())
    getYield.mockResolvedValue(emptyYield())

    render(<Optimize period="30days" provider="all" />)

    expect(await screen.findByText('No waste findings in this range yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Waste $0.00' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reverts $0.00' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abandoned $0.00' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fixes 0' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reverts $0.00' }))
    expect(screen.getByText('No reverted sessions in this range yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abandoned $0.00' }))
    expect(screen.getByText('No abandoned sessions in this range yet.')).toBeInTheDocument()
  })

  it('keeps last-good yield totals and rows visible during revalidation', async () => {
    getYield.mockResolvedValueOnce(makeYield()).mockImplementation(() => new Promise<YieldJsonReport>(() => {}))
    const overview = {
      data: makePayload(),
      error: null,
      loading: false,
      lastSuccessAt: Date.now(),
      refresh: vi.fn(),
    }

    const { rerender } = render(<OptimizeContent period="30days" overview={overview} refreshToken={0} />)

    expect(await screen.findByRole('button', { name: 'Reverts $107.00' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reverts $107.00' }))
    expect(screen.getByText('codeburn')).toBeInTheDocument()

    rerender(<OptimizeContent period="30days" overview={overview} refreshToken={1} />)
    await waitFor(() => expect(getYield).toHaveBeenCalledTimes(2))

    expect(screen.getByRole('button', { name: 'Reverts $107.00' })).toBeInTheDocument()
    expect(screen.getByText('codeburn')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})
