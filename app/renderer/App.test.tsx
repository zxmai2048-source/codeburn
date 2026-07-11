// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { DateRange, MenubarPayload, SpendFlow } from './lib/types'

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn<(period: string, provider: string, range?: DateRange) => Promise<MenubarPayload>>(),
  getSpendFlow: vi.fn<(period: string, provider: string, range?: DateRange) => Promise<SpendFlow>>(),
  getModels: vi.fn(),
  getPlans: vi.fn(),
  getActReport: vi.fn(),
  getYield: vi.fn(),
  getDevices: vi.fn(),
  getDevicesScan: vi.fn(),
  getIdentity: vi.fn(),
  cliStatus: vi.fn(),
}))

vi.mock('./lib/ipc', async orig => {
  const actual = await orig<typeof import('./lib/ipc')>()
  return { ...actual, codeburn: mocks }
})

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function overviewPayload(): MenubarPayload {
  const now = new Date()
  return {
    generated: now.toISOString(),
    current: {
      label: 'Last 30 days',
      cost: 12.34,
      calls: 12,
      sessions: 2,
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
      providers: { claude: 10, codex: 2 },
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
    optimize: { findingCount: 0, savingsUSD: 0, topFindings: [] },
    history: {
      daily: [
        {
          date: dateKey(now),
          cost: 12.34,
          savingsUSD: 0,
          calls: 12,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          topModels: [],
        },
      ],
    },
  }
}

describe('App shortcuts', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.getOverview.mockResolvedValue(overviewPayload())
    mocks.getSpendFlow.mockResolvedValue({ period: { label: 'Last 30 days', start: '', end: '' }, models: [], projects: [], links: [] })
    mocks.getModels.mockResolvedValue([])
    mocks.getPlans.mockResolvedValue({})
    mocks.getActReport.mockResolvedValue({ totals: { realizedCostUSD: 0, measuredActions: 0 } })
    mocks.getYield.mockResolvedValue({
      period: { label: 'Last 30 days', start: '', end: '' },
      summary: {
        productive: { costUSD: 0, sessions: 0, costPercent: 0, sessionPercent: 0 },
        reverted: { costUSD: 0, sessions: 0, costPercent: 0, sessionPercent: 0 },
        abandoned: { costUSD: 0, sessions: 0, costPercent: 0, sessionPercent: 0 },
        total: { costUSD: 0, sessions: 0 },
        productiveToRevertedCostRatio: null,
      },
      details: [],
    })
    mocks.getIdentity.mockResolvedValue({ name: 'CodeBurn Mac', fingerprint: 'AA:BB:CC' })
    mocks.getDevicesScan.mockResolvedValue({ found: [] })
    mocks.getDevices.mockResolvedValue({
      perDevice: [],
      combined: {
        cost: 0,
        calls: 0,
        sessions: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreateTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        deviceCount: 1,
        reachableCount: 1,
      },
    })
  })

  it('switches sections with command-number shortcuts', async () => {
    render(<App />)

    expect(await screen.findByText('Most expensive sessions')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: '2', metaKey: true })

    expect(await screen.findByText('Cost flow · model → project')).toBeInTheDocument()
  })

  it('keeps command navigation, settings, and refresh shortcuts active without stale hints', async () => {
    render(<App />)

    expect(await screen.findByText('Most expensive sessions')).toBeInTheDocument()
    expect(screen.getByText('⌘1-5')).toBeInTheDocument()
    expect(screen.getAllByText('⌘,').length).toBeGreaterThan(0)
    expect(screen.getByText('⌘R')).toBeInTheDocument()
    expect(screen.queryByText('Command')).not.toBeInTheDocument()
    expect(screen.queryByText('Export view')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: '2', metaKey: true })
    expect(await screen.findByText('Cost flow · model → project')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: '3', metaKey: true })
    expect(await screen.findByText('No waste findings in this range yet.')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: '4', metaKey: true })
    expect(await screen.findByText('No model usage in this range yet.')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: '5', metaKey: true })
    expect(await screen.findByText('No plans configured')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: ',', metaKey: true })
    expect((await screen.findAllByText('Settings')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Back')).not.toBeInTheDocument()

    const overviewCalls = mocks.getOverview.mock.calls.length
    fireEvent.keyDown(document, { key: 'r', metaKey: true })
    await waitFor(() => expect(mocks.getOverview.mock.calls.length).toBeGreaterThan(overviewCalls))
  })

  it('re-polls visible section data when period or provider changes', async () => {
    render(<App />)

    fireEvent.keyDown(document, { key: '2', metaKey: true })
    expect(await screen.findByText('Cost flow · model → project')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Today'))

    await waitFor(() => {
      expect(mocks.getOverview).toHaveBeenCalledWith('today', 'all')
      expect(mocks.getSpendFlow).toHaveBeenCalledWith('today', 'all')
    })

    fireEvent.click(screen.getByText('All providers'))
    fireEvent.click(await screen.findByRole('option', { name: 'Claude' }))

    await waitFor(() => {
      expect(mocks.getOverview).toHaveBeenCalledWith('today', 'claude')
      expect(mocks.getSpendFlow).toHaveBeenCalledWith('today', 'claude')
    })
  })

  it('applies a calendar range to overview and visible section polls', async () => {
    render(<App />)

    fireEvent.keyDown(document, { key: '2', metaKey: true })
    expect(await screen.findByText('Cost flow · model → project')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose date range' }))

    const to = new Date()
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 2)
    const fromLabel = from.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const toLabel = to.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const range = { from: dateKey(from), to: dateKey(to) }

    fireEvent.mouseDown(screen.getByRole('button', { name: fromLabel }))
    fireEvent.mouseEnter(screen.getByRole('button', { name: toLabel }))
    fireEvent.mouseUp(screen.getByRole('button', { name: toLabel }))

    await waitFor(() => {
      expect(mocks.getOverview).toHaveBeenCalledWith('30days', 'all', range)
      expect(mocks.getSpendFlow).toHaveBeenCalledWith('30days', 'all', range)
    })
    expect(screen.getByRole('button', { name: /–/ })).toBeInTheDocument()
    expect(screen.getByText('30D')).not.toHaveClass('on')
  })
})
