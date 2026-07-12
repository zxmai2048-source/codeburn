import { useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { seriesColorForModel } from '../components/ListRow'
import { Panel } from '../components/Panel'
import { SegTabs } from '../components/SegTabs'
import type { Section } from '../components/Sidebar'
import { usePolled } from '../hooks/usePolled'
import { formatUsd } from '../lib/format'
import { codeburn } from '../lib/ipc'
import type { DateRange, ModelReportRow, Period } from '../lib/types'

type ModelsLens = 'model' | 'task'

const LENSES = [
  { value: 'model', label: 'By model' },
  { value: 'task', label: 'By task' },
]

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtCompact(n: number): string {
  if (n === 0) return '0'
  if (n < 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: n >= 10_000_000 ? 1 : 2,
  }).format(n)
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>{children}</p>
}

export function Models({
  period,
  provider,
  range = null,
  refreshToken = 0,
  onNavigate,
}: {
  period: Period
  provider: string
  range?: DateRange | null
  refreshToken?: number
  onNavigate?: (section: Section) => void
}) {
  const [lens, setLens] = useState<ModelsLens>('model')
  const byTask = lens === 'task'
  const report = usePolled<ModelReportRow[]>(
    () => range ? codeburn.getModels(period, provider, byTask, range) : codeburn.getModels(period, provider, byTask),
    [period, provider, byTask, range?.from, range?.to, refreshToken],
  )

  if (!report.data) {
    if (report.error) return <CliErrorPanel error={report.error} subject="model usage" />
    return (
      <Panel title="Models">
        <EmptyNote>Scanning model usage…</EmptyNote>
      </Panel>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'flex-start' }}>
        <SegTabs options={LENSES} value={lens} onChange={value => setLens(value as ModelsLens)} />
        <button type="button" className="btn btn-s" onClick={() => onNavigate?.('compare')}>
          Compare…
        </button>
      </div>
      <Panel bodyStyle={{ overflowX: 'auto' }}>
        {report.data.length ? (
          <ModelsTable rows={report.data} byTask={byTask} />
        ) : (
          <EmptyNote>No model usage in this range yet.</EmptyNote>
        )}
      </Panel>
    </>
  )
}

function ModelsTable({ rows, byTask }: { rows: ModelReportRow[]; byTask: boolean }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>Calls</th>
          <th>Input</th>
          <th>Output</th>
          <th>Cache read</th>
          <th>Cost</th>
          <th>Saved</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <ModelTableRow key={`${row.provider}-${row.model}-${row.category ?? 'all'}-${i}`} row={row} byTask={byTask} />
        ))}
      </tbody>
    </table>
  )
}

function ModelTableRow({ row, byTask }: { row: ModelReportRow; byTask: boolean }) {
  const unpriced = row.costUSD === 0 && row.savingsUSD === 0
  const cellClass = unpriced ? 'dim' : undefined
  const tokenValue = (value: number) => (unpriced ? '—' : fmtCompact(value))
  const dotStyle = {
    display: 'inline-block',
    background: seriesColorForModel(row.modelDisplayName || row.model),
    marginRight: 8,
  }

  return (
    <tr>
      <td className={cellClass} title={row.model}>
        <span className="mdot" style={dotStyle} />
        {row.modelDisplayName}
        {byTask && row.category ? (
          <>
            {' · '}
            <span className="est">{row.category}</span>
          </>
        ) : null}
        {unpriced ? (
          <>
            {' '}
            <span className="alias">add alias ›</span>
          </>
        ) : null}
      </td>
      <td className={cellClass}>{fmtInt(row.calls)}</td>
      <td className={cellClass}>{tokenValue(row.inputTokens)}</td>
      <td className={cellClass}>{tokenValue(row.outputTokens)}</td>
      <td className={cellClass}>{tokenValue(row.cacheReadTokens)}</td>
      <td className={cellClass}>{unpriced ? '—' : formatUsd(row.costUSD)}</td>
      <td className={unpriced ? 'dim' : row.savingsUSD > 0 ? 'pos' : undefined}>{unpriced ? '—' : formatUsd(row.savingsUSD)}</td>
    </tr>
  )
}
