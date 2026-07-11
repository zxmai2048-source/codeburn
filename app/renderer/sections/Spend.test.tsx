// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload, SpendFlow } from '../lib/types'
import { Spend } from './Spend'

const { getOverview, getSpendFlow } = vi.hoisted(() => ({
  getOverview: vi.fn<(period: string, provider: string) => Promise<MenubarPayload>>(),
  getSpendFlow: vi.fn<(period: string, provider: string) => Promise<SpendFlow>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, codeburn: { getOverview, getSpendFlow } }
})

function daily(date: string, cost: number, models: Array<{ name: string; cost: number }>) {
  return {
    date,
    cost,
    savingsUSD: 0,
    calls: 10,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    topModels: models.map(m => ({
      name: m.name,
      cost: m.cost,
      savingsUSD: 0,
      calls: 5,
      inputTokens: 0,
      outputTokens: 0,
    })),
  }
}

function makePayload(now: Date): MenubarPayload {
  return {
    generated: now.toISOString(),
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
      topActivities: [{ name: 'coding', cost: 42, savingsUSD: 0, turns: 12, oneShotRate: null }],
      topModels: [],
      localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
      providers: {},
      topProjects: [
        {
          name: 'codeburn',
          cost: 246.1,
          savingsUSD: 0,
          sessions: 124,
          avgCostPerSession: 1.98,
          sessionDetails: [],
        },
        {
          name: 'agentseal-dash',
          cost: 141.3,
          savingsUSD: 0,
          sessions: 74,
          avgCostPerSession: 1.91,
          sessionDetails: [],
        },
      ],
      modelEfficiency: [],
      topSessions: [],
      retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
      routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
      tools: [{ name: 'Read', calls: 30 }],
      skills: [{ name: 'imagegen', turns: 3, cost: 1.25 }],
      subagents: [{ name: 'reviewer', calls: 2, cost: 2.5 }],
      mcpServers: [{ name: 'filesystem', calls: 9 }],
    },
    optimize: { findingCount: 0, savingsUSD: 0, topFindings: [] },
    history: {
      daily: [
        daily('2026-06-30', 11, [{ name: 'claude-opus-4', cost: 11 }]),
        daily('2026-07-01', 12, [{ name: 'gpt-5.5-codex', cost: 12 }]),
        daily('2026-07-04', 13, [{ name: 'claude-opus-4', cost: 9 }, { name: 'claude-sonnet-5', cost: 4 }]),
        daily('2026-07-06', 8, [{ name: 'claude-haiku-4', cost: 8 }]),
        daily('2026-07-10', 15, [{ name: 'gpt-5.5-codex', cost: 15 }]),
      ],
    },
  }
}

function makeFlow(): SpendFlow {
  return {
    period: { label: 'Last 7 days', start: '2026-07-04', end: '2026-07-10' },
    models: [
      { id: 'claude-opus-4-20260701', label: 'claude-opus-4-20260701', cost: 22 },
      { id: 'gpt-5.5-codex', label: 'gpt-5.5-codex', cost: 18 },
    ],
    projects: [
      { id: '/Users/me/src/mobile-app', label: '/Users/me/src/mobile-app', cost: 30 },
      { id: '__other__', label: '__other__', cost: 10 },
    ],
    links: [
      { model: 'claude-opus-4-20260701', project: '/Users/me/src/mobile-app', cost: 18 },
      { model: 'claude-opus-4-20260701', project: '__other__', cost: 4 },
      { model: 'gpt-5.5-codex', project: '/Users/me/src/mobile-app', cost: 12 },
      { model: 'gpt-5.5-codex', project: '__other__', cost: 6 },
    ],
  }
}

function emptyFlow(): SpendFlow {
  return {
    period: { label: 'Last 7 days', start: '2026-07-04', end: '2026-07-10' },
    models: [],
    projects: [],
    links: [],
  }
}

describe('Spend', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 10, 12, 0, 0))
    getOverview.mockReset()
    getSpendFlow.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('slices stacked spend bars to the selected period, renders projects, and draws one Sankey ribbon per link', async () => {
    getOverview.mockResolvedValue(makePayload(new Date()))
    getSpendFlow.mockResolvedValue(makeFlow())

    const { container } = render(<Spend period="week" provider="all" />)

    expect(await screen.findByText('codeburn')).toBeInTheDocument()
    expect(screen.getByText('$246.10')).toBeInTheDocument()
    expect(screen.getByText('agentseal-dash')).toBeInTheDocument()
    expect(screen.getByText('top 2')).toBeInTheDocument()

    const barColumns = container.querySelectorAll('.sbars .c')
    expect(barColumns).toHaveLength(3)
    expect([...barColumns].map(col => col.getAttribute('data-date'))).toEqual([
      '2026-07-04',
      '2026-07-06',
      '2026-07-10',
    ])

    expect(container.querySelectorAll('[data-testid="sankey-ribbon"]')).toHaveLength(makeFlow().links.length)
  })

  it.each([
    ['Activity', ['coding', '$42.00', 'imagegen', '$1.25']],
    ['Tools', ['Read', '30 calls']],
    ['MCP', ['filesystem', '9 calls']],
    ['Subagents', ['reviewer', '$2.50']],
  ])('renders %s lens data', async (tab, expectedTexts) => {
    getOverview.mockResolvedValue(makePayload(new Date()))
    getSpendFlow.mockResolvedValue(makeFlow())

    render(<Spend period="week" provider="all" />)
    expect(await screen.findByText('codeburn')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: tab }))

    for (const text of expectedTexts) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it.each([
    ['Activity', 'No activity or skill spend in this range yet.'],
    ['Tools', 'No tool calls in this range yet.'],
    ['MCP', 'No MCP server calls in this range yet.'],
    ['Subagents', 'No subagent spend in this range yet.'],
  ])('renders the honest empty state for %s', async (tab, emptyText) => {
    const payload = makePayload(new Date())
    payload.current.topActivities = []
    payload.current.skills = []
    payload.current.tools = []
    payload.current.mcpServers = []
    payload.current.subagents = []
    getOverview.mockResolvedValue(payload)
    getSpendFlow.mockResolvedValue(makeFlow())

    render(<Spend period="week" provider="all" />)
    expect(await screen.findByText('codeburn')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: tab }))

    expect(screen.getByText(emptyText)).toBeInTheDocument()
  })

  it('renders empty stacked chart and empty flow states', async () => {
    const payload = makePayload(new Date())
    payload.history.daily = []
    getOverview.mockResolvedValue(payload)
    getSpendFlow.mockResolvedValue(emptyFlow())

    render(<Spend period="week" provider="all" />)

    expect(await screen.findByText('No model spend in this range yet.')).toBeInTheDocument()
    expect(await screen.findByText('No model-project flow in this range yet.')).toBeInTheDocument()
  })

  it('renders the flow error path without hiding the rest of spend', async () => {
    getOverview.mockResolvedValue(makePayload(new Date()))
    getSpendFlow.mockRejectedValue({ kind: 'nonzero', message: 'flow command failed' })

    render(<Spend period="week" provider="all" />)

    expect(await screen.findByText('codeburn')).toBeInTheDocument()
    expect(await screen.findByText('flow command failed')).toBeInTheDocument()
  })

  it('renders the not-found panel when codeburn is not on PATH', async () => {
    getOverview.mockRejectedValue({ kind: 'not-found', message: 'codeburn not found' })
    getSpendFlow.mockResolvedValue(emptyFlow())

    render(<Spend period="week" provider="all" />)

    expect(await screen.findByText('Locate the codeburn CLI')).toBeInTheDocument()
    expect(screen.getByText(/isn't on your PATH yet/)).toBeInTheDocument()
  })

  it('maps stacked segments to the expected model series classes', async () => {
    const payload = makePayload(new Date())
    payload.history.daily = [
      daily('2026-07-10', 25, [
        { name: 'claude-opus-4', cost: 5 },
        { name: 'claude-sonnet-5', cost: 5 },
        { name: 'claude-haiku-4', cost: 5 },
        { name: 'gpt-5.5-codex', cost: 5 },
        { name: 'mystery-model', cost: 5 },
      ]),
    ]
    getOverview.mockResolvedValue(payload)
    getSpendFlow.mockResolvedValue(makeFlow())

    const { container } = render(<Spend period="week" provider="all" />)
    expect(await screen.findByLabelText('Daily spend by model')).toBeInTheDocument()

    expect(container.querySelector('.sbars .s-opus')).toBeInTheDocument()
    expect(container.querySelector('.sbars .s-son')).toBeInTheDocument()
    expect(container.querySelector('.sbars .s-hai')).toBeInTheDocument()
    expect(container.querySelector('.sbars .s-gpt')).toBeInTheDocument()
    expect(container.querySelector('.sbars .s-other')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('renders Sankey ribbons with model gradients, neutral other nodes, and shortened labels', async () => {
    getOverview.mockResolvedValue(makePayload(new Date()))
    getSpendFlow.mockResolvedValue(makeFlow())

    const { container } = render(<Spend period="week" provider="all" />)

    expect(await screen.findAllByText(/Opus 4.8/)).toHaveLength(2)
    expect(screen.getByText(/mobile-app/)).toBeInTheDocument()
    expect(screen.queryByText(/Users\/me\/src\/mobile-app/)).not.toBeInTheDocument()

    const opusRibbon = container.querySelector('[data-testid="sankey-ribbon"][data-model="claude-opus-4-20260701"]')
    expect(opusRibbon?.getAttribute('stroke')).toBe('url(#sankey-claude-opus-4-20260701)')
    const opusStop = container.querySelector('linearGradient[id="sankey-claude-opus-4-20260701"] stop')
    expect(opusStop?.getAttribute('stop-color')).toBe('#5B8CFF')
    const otherNode = container.querySelector('[data-testid="sankey-node"][data-node-id="__other__"]')
    expect(otherNode?.getAttribute('fill')).toBe('#5F6780')
  })
})
