import { useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { Panel } from '../components/Panel'
import { SegTabs } from '../components/SegTabs'
import { type Polled, usePolled } from '../hooks/usePolled'
import { formatUsd } from '../lib/format'
import { codeburn } from '../lib/ipc'
import type { DateRange, MenubarPayload, Period, SessionYieldJson, YieldJsonReport } from '../lib/types'

type OptimizeTab = 'waste' | 'reverts' | 'abandoned' | 'fixes'

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>{children}</p>
}

export function Optimize({ period, provider, range = null }: { period: Period; provider: string; range?: DateRange | null }) {
  const overview = usePolled<MenubarPayload>(
    () => range ? codeburn.getOverview(period, provider, range) : codeburn.getOverview(period, provider),
    [period, provider, range?.from, range?.to],
  )
  return <OptimizeContent period={period} range={range} overview={overview} />
}

export function OptimizeContent({
  period,
  range = null,
  overview,
  refreshToken = 0,
}: {
  period: Period
  range?: DateRange | null
  overview: Polled<MenubarPayload>
  refreshToken?: number
}) {
  const yieldReport = usePolled<YieldJsonReport>(
    () => range ? codeburn.getYield(period, range) : codeburn.getYield(period),
    [period, range?.from, range?.to, refreshToken],
  )
  const [tab, setTab] = useState<OptimizeTab>('waste')

  if (!overview.data) {
    if (overview.error) return <CliErrorPanel error={overview.error} subject="optimize findings" />
    return (
      <Panel title="Optimize">
        <EmptyNote>Scanning optimize findings…</EmptyNote>
      </Panel>
    )
  }

  const yieldData = yieldReport.error ? null : yieldReport.data
  const revertedTotal = yieldData ? formatUsd(yieldData.summary.reverted.costUSD) : '—'
  const abandonedTotal = yieldData ? formatUsd(yieldData.summary.abandoned.costUSD) : '—'
  const options = [
    { value: 'waste', label: `Waste ${formatUsd(overview.data.optimize.savingsUSD)}` },
    { value: 'reverts', label: `Reverts ${revertedTotal}` },
    { value: 'abandoned', label: `Abandoned ${abandonedTotal}` },
    { value: 'fixes', label: `Fixes ${overview.data.optimize.findingCount.toLocaleString('en-US')}` },
  ]

  return (
    <>
      <SegTabs
        options={options}
        value={tab}
        onChange={value => setTab(value as OptimizeTab)}
        style={{ alignSelf: 'flex-start' }}
      />
      <Panel>
        {tab === 'waste' ? (
          <WasteRows data={overview.data} />
        ) : tab === 'reverts' ? (
          <YieldRows report={yieldReport} category="reverted" empty="No reverted sessions in this range yet." />
        ) : tab === 'abandoned' ? (
          <YieldRows report={yieldReport} category="abandoned" empty="No abandoned sessions in this range yet." />
        ) : (
          <FixesRows data={overview.data} />
        )}
      </Panel>
    </>
  )
}

function WasteRows({ data }: { data: MenubarPayload }) {
  const findings = data.optimize.topFindings

  if (!findings.length) return <EmptyNote>No waste findings in this range yet.</EmptyNote>

  return (
    <>
      {findings.map((finding, i) => (
        <div className="li" style={{ alignItems: 'flex-start' }} key={`${finding.title}-${i}`}>
          <span className="no">{String(i + 1).padStart(2, '0')}</span>
          <div className="lx">
            <b>{finding.title}</b>
            <span>{finding.impact} impact</span>
          </div>
          <span className="val ok">{formatUsd(finding.savingsUSD)}</span>
        </div>
      ))}
    </>
  )
}

function YieldRows({
  report,
  category,
  empty,
}: {
  report: Polled<YieldJsonReport>
  category: SessionYieldJson['category']
  empty: string
}) {
  if (report.error || !report.data) return <EmptyNote>—</EmptyNote>

  const rows = report.data.details.filter(row => row.category === category)
  if (!rows.length) return <EmptyNote>{empty}</EmptyNote>

  return (
    <>
      {rows.map((row, i) => (
        <div className="li" style={{ alignItems: 'flex-start' }} key={row.sessionId}>
          <span className="no">{String(i + 1).padStart(2, '0')}</span>
          <div className="lx">
            <b>{row.project}</b>
            <span>
              {row.commitCount.toLocaleString('en-US')} {row.commitCount === 1 ? 'commit' : 'commits'} · {row.sessionId}
            </span>
          </div>
          <span className="val">{formatUsd(row.costUSD)}</span>
        </div>
      ))}
    </>
  )
}

function FixesRows({ data }: { data: MenubarPayload }) {
  const count = data.optimize.findingCount
  if (!count) return <EmptyNote>No fixes in this range yet.</EmptyNote>

  return (
    <div className="li" style={{ alignItems: 'flex-start' }}>
      <span className="no">{String(count).padStart(2, '0')}</span>
      <div className="lx">
        <b>
          {count.toLocaleString('en-US')} findings · {formatUsd(data.optimize.savingsUSD)} potential
        </b>
      </div>
    </div>
  )
}
