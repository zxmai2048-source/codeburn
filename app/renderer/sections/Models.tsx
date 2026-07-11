import { useState } from 'react'

import { seriesColorForModel } from '../components/ListRow'
import { Panel } from '../components/Panel'
import { SegTabs } from '../components/SegTabs'
import { usePolled } from '../hooks/usePolled'
import { codeburn } from '../lib/ipc'
import type { ModelReportRow, Period } from '../lib/types'

type ModelsLens = 'model' | 'task'

const LENSES = [
  { value: 'model', label: 'By model' },
  { value: 'task', label: 'By task' },
]

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

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

export function Models({ period, provider }: { period: Period; provider: string }) {
  const [lens, setLens] = useState<ModelsLens>('model')
  const byTask = lens === 'task'
  const report = usePolled<ModelReportRow[]>(
    () => codeburn.getModels(period, provider, byTask),
    [period, provider, byTask],
  )

  if (!report.data) {
    if (report.error?.kind === 'not-found') {
      return (
        <Panel title="Locate the codeburn CLI">
          <p style={{ color: 'var(--t2)', margin: '0 0 6px', fontSize: 12.5 }}>
            CodeBurn Desktop reads your model usage by running the{' '}
            <code style={{ fontFamily: 'var(--mono)', color: 'var(--lav)' }}>codeburn</code> command, but it isn&apos;t
            on your PATH yet.
          </p>
          <p style={{ color: 'var(--t3)', margin: 0, fontSize: 11.5 }}>
            Install it with <code style={{ fontFamily: 'var(--mono)', color: 'var(--lav)' }}>npm i -g codeburn</code>,
            then reopen this window.
          </p>
        </Panel>
      )
    }
    if (report.error) {
      return (
        <Panel title="Couldn't read models">
          <p style={{ color: 'var(--red)', margin: 0, fontSize: 12 }}>{report.error.message}</p>
        </Panel>
      )
    }
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
        <span className="btn btn-s" aria-disabled="true">
          Compare…
        </span>
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
      <td className={cellClass}>{unpriced ? '—' : fmtUsd(row.costUSD)}</td>
      <td className={unpriced ? 'dim' : row.savingsUSD > 0 ? 'pos' : undefined}>{unpriced ? '—' : fmtUsd(row.savingsUSD)}</td>
    </tr>
  )
}
