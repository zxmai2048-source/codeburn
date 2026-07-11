import { useCallback, useEffect, useState } from 'react'

import { Hint } from './components/Hint'
import { Panel } from './components/Panel'
import { Sidebar, type Section } from './components/Sidebar'
import { rangeLabel, TopBar } from './components/TopBar'
import { Window } from './components/Window'
import { usePolled } from './hooks/usePolled'
import { formatUsd } from './lib/format'
import { codeburn } from './lib/ipc'
import { OverviewContent } from './sections/Overview'
import { OptimizeContent } from './sections/Optimize'
import { Models } from './sections/Models'
import { Plans } from './sections/Plans'
import { Settings } from './sections/Settings'
import { SpendContent } from './sections/Spend'
import type { DateRange, MenubarPayload, Period } from './lib/types'

const SECTION_TITLES: Record<Section, string> = {
  overview: 'Overview',
  spend: 'Spend',
  optimize: 'Optimize',
  models: 'Models',
  plans: 'Plans',
  settings: 'Settings',
}

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'This month',
  '30days': 'Last 30 days',
  all: 'All time',
}

const STANDARD_PERIODS: Period[] = ['today', 'week', '30days', 'month', 'all']

function isPeriod(value: string): value is Period {
  return (STANDARD_PERIODS as string[]).includes(value)
}

function providerName(provider: string): string {
  if (provider === 'all') return 'All providers'
  return provider
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function refreshedLabel(lastSuccessAt: number | null, loading: boolean, now: number): string {
  if (loading && lastSuccessAt === null) return 'refreshing…'
  if (lastSuccessAt === null) return 'not refreshed yet'
  const seconds = Math.max(0, Math.floor((now - lastSuccessAt) / 1000))
  if (seconds < 1) return 'refreshed just now'
  if (seconds < 60) return `refreshed ${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `refreshed ${minutes}m ago`
}

export function App() {
  const [section, setSection] = useState<Section>('overview')
  const [period, setPeriod] = useState<Period>('30days')
  const [provider, setProvider] = useState<string>('all')
  const [detectedProviders, setDetectedProviders] = useState<string[]>([])
  const [customRange, setCustomRange] = useState<DateRange | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const overview = usePolled<MenubarPayload>(
    () => customRange
      ? codeburn.getOverview(period, provider, customRange)
      : codeburn.getOverview(period, provider),
    [period, provider, customRange?.from, customRange?.to],
  )
  const refreshOverview = overview.refresh

  useEffect(() => {
    if (!overview.data) return
    const found = Object.keys(overview.data.current.providers)
    setDetectedProviders(current => {
      const next = [...current]
      for (const item of found) if (!next.includes(item)) next.push(item)
      return next.length === current.length ? current : next
    })
  }, [overview.data])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const refreshVisible = useCallback(() => {
    refreshOverview()
    setRefreshToken(token => token + 1)
  }, [refreshOverview])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
      const key = event.key.toLowerCase()
      if (key === '1') setSection('overview')
      else if (key === '2') setSection('spend')
      else if (key === '3') setSection('optimize')
      else if (key === '4') setSection('models')
      else if (key === '5') setSection('plans')
      else if (key === ',') setSection('settings')
      else if (key === 'r') refreshVisible()
      else return
      event.preventDefault()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [refreshVisible])

  const onPeriodChange = (value: string) => {
    if (isPeriod(value)) {
      setCustomRange(null)
      setPeriod(value)
    }
  }

  const providerOptions = [
    { value: 'all', label: 'All providers' },
    ...detectedProviders.map(value => ({ value, label: providerName(value) })),
  ]
  const providerLabel = providerName(provider)
  const scope = `${customRange ? rangeLabel(customRange) : PERIOD_LABELS[period]} · ${providerLabel}`

  return (
    <Window>
      <Sidebar active={section} onNavigate={setSection} status={<StatusLine polled={overview} />} />
      <div className="ct">
        {section === 'plans' ? (
          <Plans period={period} refreshToken={refreshToken} />
        ) : section === 'settings' ? (
          <Settings period={period} refreshToken={refreshToken} />
        ) : (
          <>
            <TopBar
              title={SECTION_TITLES[section]}
              scope={scope}
              period={period}
              onPeriodChange={onPeriodChange}
              customRange={customRange}
              onRangeSelect={setCustomRange}
              provider={provider}
              providerLabel={providerLabel}
              providerOptions={providerOptions}
              onProviderSelect={setProvider}
            />
            <div className="body">
              {section === 'overview' ? (
                <OverviewContent period={period} overview={overview} onNavigate={setSection} />
              ) : section === 'spend' ? (
                <SpendContent period={period} provider={provider} range={customRange} overview={overview} refreshToken={refreshToken} />
              ) : section === 'optimize' ? (
                <OptimizeContent period={period} range={customRange} overview={overview} refreshToken={refreshToken} />
              ) : section === 'models' ? (
                <Models period={period} provider={provider} range={customRange} refreshToken={refreshToken} />
              ) : (
                <SectionPlaceholder title={SECTION_TITLES[section]} />
              )}
            </div>
          </>
        )}
        {section !== 'settings' && (
          <Hint
            items={[
              { k: '⌘1-5', label: 'Navigate' },
              { k: '⌘,', label: 'Settings' },
              { k: '⌘R', label: 'Refresh' },
            ]}
            right={refreshedLabel(overview.lastSuccessAt, overview.loading, now)}
          />
        )}
      </div>
    </Window>
  )
}

function StatusLine({ polled }: { polled: ReturnType<typeof usePolled<MenubarPayload>> }) {
  if (polled.data) {
    return (
      <>
        {polled.data.current.label} <b>{formatUsd(polled.data.current.cost)}</b>
      </>
    )
  }
  if (polled.error?.kind === 'not-found') return <>CLI not found</>
  if (polled.loading) return <>scanning…</>
  return <>—</>
}

function SectionPlaceholder({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>
        {title} lands in a later task. The shell, data bridge, and design system are in place.
      </p>
    </Panel>
  )
}
