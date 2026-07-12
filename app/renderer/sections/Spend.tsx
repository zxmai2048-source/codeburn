import { CliErrorPanel, CliErrorText } from '../components/CliErrorPanel'
import { ListRow } from '../components/ListRow'
import { Panel } from '../components/Panel'
import { Sankey } from '../components/Sankey'
import { StackedBars } from '../components/StackedBars'
import { type Polled, usePolled } from '../hooks/usePolled'
import { formatUsd } from '../lib/format'
import { codeburn } from '../lib/ipc'
import { sliceDailyToPeriod } from '../lib/period'
import type { DateRange, MenubarPayload, Period, SpendFlow } from '../lib/types'

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>{children}</p>
}

export function Spend({ period, provider, range = null }: { period: Period; provider: string; range?: DateRange | null }) {
  const overview = usePolled<MenubarPayload>(
    () => range ? codeburn.getOverview(period, provider, range) : codeburn.getOverview(period, provider),
    [period, provider, range?.from, range?.to],
  )
  return <SpendContent period={period} provider={provider} range={range} overview={overview} />
}

export function SpendContent({
  period,
  provider,
  range = null,
  overview,
  refreshToken = 0,
}: {
  period: Period
  provider: string
  range?: DateRange | null
  overview: Polled<MenubarPayload>
  refreshToken?: number
}) {
  const flow = usePolled<SpendFlow>(
    () => range ? codeburn.getSpendFlow(period, provider, range) : codeburn.getSpendFlow(period, provider),
    [period, provider, range?.from, range?.to, refreshToken],
  )

  if (!overview.data) {
    if (overview.error) return <CliErrorPanel error={overview.error} subject="spend" />
    return (
      <Panel title="Spend">
        <EmptyNote>Scanning spend…</EmptyNote>
      </Panel>
    )
  }

  return <SpendPage data={overview.data} flow={flow} period={period} range={range} />
}

function SpendPage({
  data,
  flow,
  period,
  range,
}: {
  data: MenubarPayload
  flow: ReturnType<typeof usePolled<SpendFlow>>
  period: Period
  range: DateRange | null
}) {
  const daily = range
    ? data.history.daily.filter(day => day.date >= range.from && day.date <= range.to)
    : sliceDailyToPeriod(data.history.daily, period)
  const projects = data.current.topProjects
  const breakdowns = [
    {
      title: 'Activity',
      rows: [
        ...data.current.topActivities.map(row => ({
          key: `activity-${row.name}`,
          title: row.name,
          sub: `${row.turns.toLocaleString('en-US')} turns`,
          value: formatUsd(row.cost),
        })),
        ...data.current.skills.map(row => ({
          key: `skill-${row.name}`,
          title: row.name,
          sub: `${row.turns.toLocaleString('en-US')} turns · skill`,
          value: formatUsd(row.cost),
        })),
      ],
    },
    {
      title: 'Tools',
      rows: data.current.tools.map(row => ({
        key: row.name,
        title: row.name,
        sub: `${row.calls.toLocaleString('en-US')} calls`,
        value: undefined,
      })),
    },
    {
      title: 'MCP',
      rows: data.current.mcpServers.map(row => ({
        key: row.name,
        title: row.name,
        sub: `${row.calls.toLocaleString('en-US')} calls`,
        value: undefined,
      })),
    },
    {
      title: 'Subagents',
      rows: data.current.subagents.map(row => ({
        key: row.name,
        title: row.name,
        sub: `${row.calls.toLocaleString('en-US')} calls`,
        value: formatUsd(row.cost),
      })),
    },
  ].filter(section => section.rows.length)

  return (
    <>
      <div className="spend-top-row">
        <Panel title="Daily spend by model" className="spend-chart-panel">
          {daily.length ? <StackedBars daily={daily} /> : <EmptyNote>No model spend in this range yet.</EmptyNote>}
        </Panel>
        <Panel title="By project" right={projects.length ? `top ${projects.length}` : undefined} className="spend-scroll">
          {projects.length ? (
            projects.map((project, i) => (
              <ListRow
                key={project.name}
                no={String(i + 1).padStart(2, '0')}
                title={project.name}
                sub={`${project.sessions.toLocaleString('en-US')} ${project.sessions === 1 ? 'session' : 'sessions'}`}
                value={formatUsd(project.cost)}
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
          <CliErrorText error={flow.error} />
        ) : (
          <EmptyNote>{flow.loading ? 'Loading cost flow…' : 'No model-project flow in this range yet.'}</EmptyNote>
        )}
      </Panel>

      <div className="spend-breakdowns">
        {breakdowns.length ? (
          breakdowns.map(section => <RowsPanel key={section.title} title={section.title} rows={section.rows} />)
        ) : (
          <EmptyNote>No activity, tool, MCP, or subagent data in this range yet.</EmptyNote>
        )}
      </div>
    </>
  )
}

function RowsPanel({
  title,
  rows,
}: {
  title: string
  rows: Array<{ key: string; title: string; sub: string; value?: string }>
}) {
  return (
    <Panel title={title} className="spend-scroll">
      {rows.map((row, i) => (
        <ListRow key={row.key} no={String(i + 1).padStart(2, '0')} title={row.title} sub={row.sub} value={row.value} />
      ))}
    </Panel>
  )
}
