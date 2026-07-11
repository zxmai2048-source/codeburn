import { useState } from 'react'

import { ListRow } from '../components/ListRow'
import { Panel } from '../components/Panel'
import { Sankey } from '../components/Sankey'
import { SegTabs } from '../components/SegTabs'
import { StackedBars } from '../components/StackedBars'
import { usePolled } from '../hooks/usePolled'
import { codeburn } from '../lib/ipc'
import { sliceDailyToPeriod } from '../lib/period'
import type { MenubarPayload, Period, SpendFlow } from '../lib/types'

type Lens = 'projects' | 'activity' | 'tools' | 'mcp' | 'subagents'

const LENSES = [
  { value: 'projects', label: 'Projects' },
  { value: 'activity', label: 'Activity' },
  { value: 'tools', label: 'Tools' },
  { value: 'mcp', label: 'MCP' },
  { value: 'subagents', label: 'Subagents' },
]

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>{children}</p>
}

export function Spend({ period, provider }: { period: Period; provider: string }) {
  const overview = usePolled<MenubarPayload>(() => codeburn.getOverview(period, provider), [period, provider])
  const flow = usePolled<SpendFlow>(() => codeburn.getSpendFlow(period, provider), [period, provider])
  const [lens, setLens] = useState<Lens>('projects')

  if (!overview.data) {
    if (overview.error?.kind === 'not-found') {
      return (
        <Panel title="Locate the codeburn CLI">
          <p style={{ color: 'var(--t2)', margin: '0 0 6px', fontSize: 12.5 }}>
            CodeBurn Desktop reads your usage by running the{' '}
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
    if (overview.error) {
      return (
        <Panel title="Couldn't read spend">
          <p style={{ color: 'var(--red)', margin: 0, fontSize: 12 }}>{overview.error.message}</p>
        </Panel>
      )
    }
    return (
      <Panel title="Spend">
        <EmptyNote>Scanning spend…</EmptyNote>
      </Panel>
    )
  }

  return (
    <>
      <SegTabs options={LENSES} value={lens} onChange={value => setLens(value as Lens)} style={{ alignSelf: 'flex-start' }} />
      {lens === 'projects' ? (
        <ProjectsLens data={overview.data} flow={flow} period={period} />
      ) : (
        <DetailLens data={overview.data} lens={lens} />
      )}
    </>
  )
}

function ProjectsLens({
  data,
  flow,
  period,
}: {
  data: MenubarPayload
  flow: ReturnType<typeof usePolled<SpendFlow>>
  period: Period
}) {
  const daily = sliceDailyToPeriod(data.history.daily, period)
  const projects = data.current.topProjects

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Panel title="Daily spend by model">
          {daily.length ? <StackedBars daily={daily} /> : <EmptyNote>No model spend in this range yet.</EmptyNote>}
        </Panel>
        <Panel title="By project" right={projects.length ? `top ${projects.length}` : undefined}>
          {projects.length ? (
            projects.map((project, i) => (
              <ListRow
                key={project.name}
                no={String(i + 1).padStart(2, '0')}
                title={project.name}
                sub={`${project.sessions.toLocaleString('en-US')} ${project.sessions === 1 ? 'session' : 'sessions'}`}
                value={fmtUsd(project.cost)}
              />
            ))
          ) : (
            <EmptyNote>No project spend in this range yet.</EmptyNote>
          )}
        </Panel>
      </div>

      <Panel title="Cost flow · model → project" right="click a ribbon to filter" bodyStyle={{ overflowX: 'auto' }}>
        {flow.data && flow.data.links.length ? (
          <Sankey flow={flow.data} />
        ) : flow.error ? (
          <p style={{ color: 'var(--red)', margin: 0, fontSize: 12 }}>{flow.error.message}</p>
        ) : (
          <EmptyNote>{flow.loading ? 'Loading cost flow…' : 'No model-project flow in this range yet.'}</EmptyNote>
        )}
      </Panel>
    </>
  )
}

function DetailLens({ data, lens }: { data: MenubarPayload; lens: Exclude<Lens, 'projects'> }) {
  if (lens === 'activity') {
    const rows = [
      ...data.current.topActivities.map(row => ({
        key: `activity-${row.name}`,
        title: row.name,
        sub: `${row.turns.toLocaleString('en-US')} turns`,
        value: fmtUsd(row.cost),
      })),
      ...data.current.skills.map(row => ({
        key: `skill-${row.name}`,
        title: row.name,
        sub: `${row.turns.toLocaleString('en-US')} turns · skill`,
        value: fmtUsd(row.cost),
      })),
    ]
    return <RowsPanel title="Activity" rows={rows} empty="No activity or skill spend in this range yet." />
  }

  if (lens === 'tools') {
    const rows = data.current.tools.map(row => ({
      key: row.name,
      title: row.name,
      sub: `${row.calls.toLocaleString('en-US')} calls`,
      value: undefined,
    }))
    return <RowsPanel title="Tools" rows={rows} empty="No tool calls in this range yet." />
  }

  if (lens === 'mcp') {
    const rows = data.current.mcpServers.map(row => ({
      key: row.name,
      title: row.name,
      sub: `${row.calls.toLocaleString('en-US')} calls`,
      value: undefined,
    }))
    return <RowsPanel title="MCP" rows={rows} empty="No MCP server calls in this range yet." />
  }

  const rows = data.current.subagents.map(row => ({
    key: row.name,
    title: row.name,
    sub: `${row.calls.toLocaleString('en-US')} calls`,
    value: fmtUsd(row.cost),
  }))
  return <RowsPanel title="Subagents" rows={rows} empty="No subagent spend in this range yet." />
}

function RowsPanel({
  title,
  rows,
  empty,
}: {
  title: string
  rows: Array<{ key: string; title: string; sub: string; value?: string }>
  empty: string
}) {
  return (
    <Panel title={title}>
      {rows.length ? (
        rows.map((row, i) => (
          <ListRow key={row.key} no={String(i + 1).padStart(2, '0')} title={row.title} sub={row.sub} value={row.value} />
        ))
      ) : (
        <EmptyNote>{empty}</EmptyNote>
      )}
    </Panel>
  )
}
