import { useCallback, useEffect, useState } from 'react'

import { Hint } from './components/Hint'
import { Panel } from './components/Panel'
import { Sidebar, type Section } from './components/Sidebar'
import { TopBar } from './components/TopBar'
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
import type { MenubarPayload, Period } from './lib/types'

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
const PROVIDER_OPTIONS = ['all', 'claude', 'codex', 'cursor', 'grok'] as const
const PROVIDER_LABELS: Record<(typeof PROVIDER_OPTIONS)[number], string> = {
  all: 'All providers',
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  grok: 'Grok',
}

function isPeriod(value: string): value is Period {
  return (STANDARD_PERIODS as string[]).includes(value)
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
  const [provider, setProvider] = useState<(typeof PROVIDER_OPTIONS)[number]>('all')
  const [refreshToken, setRefreshToken] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const overview = usePolled<MenubarPayload>(() => codeburn.getOverview(period, provider), [period, provider])
  const refreshOverview = overview.refresh

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
    // 6M / Custom (date ranges) are M2; ignore for now so the
    // highlight never lies about what was fetched.
    if (isPeriod(value)) setPeriod(value)
  }

  const onProviderClick = () => {
    setProvider(current => PROVIDER_OPTIONS[(PROVIDER_OPTIONS.indexOf(current) + 1) % PROVIDER_OPTIONS.length])
  }

  const providerLabel = PROVIDER_LABELS[provider]
  const scope = `${PERIOD_LABELS[period]} · ${providerLabel}`

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
              providerLabel={providerLabel}
              onProviderClick={onProviderClick}
            />
            <div className="body">
              {section === 'overview' ? (
                <OverviewContent period={period} overview={overview} onNavigate={setSection} />
              ) : section === 'spend' ? (
                <SpendContent period={period} provider={provider} overview={overview} refreshToken={refreshToken} />
              ) : section === 'optimize' ? (
                <OptimizeContent period={period} overview={overview} refreshToken={refreshToken} />
              ) : section === 'models' ? (
                <Models period={period} provider={provider} refreshToken={refreshToken} />
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
