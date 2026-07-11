import { useEffect, useMemo, useRef, useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { ListRow, seriesColorForModel } from '../components/ListRow'
import { Panel } from '../components/Panel'
import { type Polled, usePolled } from '../hooks/usePolled'
import { formatUsd } from '../lib/format'
import { codeburn } from '../lib/ipc'
import { localDateKey, sliceDailyToPeriod } from '../lib/period'
import type {
  ActReportJson,
  DailyHistoryEntry,
  JsonPlanSummary,
  MenubarPayload,
  Period,
  PlanId,
  StatusJson,
} from '../lib/types'

export { localDateKey } from '../lib/period'

const PLAN_NAMES: Record<PlanId, string> = {
  'claude-pro': 'Claude Pro',
  'claude-max': 'Claude Max',
  'claude-max-5x': 'Claude Max 5x',
  'cursor-pro': 'Cursor Pro',
  supergrok: 'SuperGrok',
  'supergrok-heavy': 'SuperGrok Heavy',
  custom: 'Custom plan',
  none: 'API usage',
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function deriveStats(data: MenubarPayload, now: Date) {
  const daily = data.history.daily
  const todayKey = localDateKey(now)
  const todayEntry = daily.find(day => day.date === todayKey)
  const monthPrefix = todayKey.slice(0, 7)
  const mtdEntries = daily.filter(day => day.date.startsWith(monthPrefix))
  const mtd = mtdEntries.reduce((sum, day) => sum + day.cost, 0)
  const medianDaily = median(daily.slice(-7).map(day => day.cost))
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const projected = mtd + medianDaily * Math.max(0, daysInMonth - now.getDate())
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevPrefix = localDateKey(prevMonth).slice(0, 7)
  const priorEntries = daily.filter(day => day.date.startsWith(prevPrefix))
  const priorAverage = mean(priorEntries.map(day => day.cost))
  const currentAverage = mean(mtdEntries.map(day => day.cost))
  const pacePct = priorAverage > 0 ? ((currentAverage - priorAverage) / priorAverage) * 100 : null

  return {
    todayEntry,
    todayCost: todayEntry?.cost ?? 0,
    mtd,
    projected,
    pacePct,
    prevMonthName: prevMonth.toLocaleString('en-US', { month: 'long' }),
  }
}

export function sessionModelKey(project: string, date: string, calls: number, cost: number): string {
  return `${project}|${date}|${calls}|${cost}`
}

function buildModelIndex(data: MenubarPayload): Map<string, string> {
  const index = new Map<string, string>()
  for (const project of data.current.topProjects) {
    for (const session of project.sessionDetails) {
      const dominant = [...session.models].sort((a, b) => b.cost - a.cost)[0]
      if (dominant) index.set(sessionModelKey(project.name, session.date, session.calls, session.cost), dominant.name)
    }
  }
  return index
}

function streakDays(daily: DailyHistoryEntry[], now: Date): number {
  const byDate = new Map(daily.map(day => [day.date, day.cost]))
  let streak = 0
  for (let offset = 0; ; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    if ((byDate.get(localDateKey(date)) ?? 0) <= 0) break
    streak++
  }
  return streak
}

function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let frame = 0
    const start = performance.now()
    const duration = 850
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      element.textContent = formatUsd(value * eased)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return <div ref={ref} className="ov-hero-num" data-countup={value}>{formatUsd(value)}</div>
}

function Sparkline({ values, ok = false, hero = false }: { values: number[]; ok?: boolean; hero?: boolean }) {
  const width = hero ? 240 : 120
  const height = hero ? 44 : 26
  const lineBottom = hero ? 38 : 24
  const max = Math.max(...values, 0)
  const points = (values.length ? values : [0]).map((value, index, all) => {
    const x = all.length === 1 ? width : (index / (all.length - 1)) * width
    const y = max > 0 ? lineBottom - (value / max) * (lineBottom - 5) : lineBottom
    return [x, y] as const
  })
  const pointString = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `0,${height} ${pointString} ${width},${height}`
  const last = points[points.length - 1]

  return (
    <div className={`ov-spark${ok ? ' ov-spark-ok' : ''}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={area} />
        <polyline points={pointString} vectorEffect="non-scaling-stroke" />
        {hero && <line className="dot" x1={last[0]} y1={last[1]} x2={last[0]} y2={last[1] - 0.1} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  )
}

function planSummaries(status: StatusJson | null): JsonPlanSummary[] {
  if (!status) return []
  const plans = Object.values(status.plans ?? {}).filter((plan): plan is JsonPlanSummary => Boolean(plan))
  if (plans.length) return plans
  return status.plan ? [status.plan] : []
}

function FuelRing({ status, onNavigate }: { status: StatusJson | null; onNavigate?: (section: 'plans') => void }) {
  const plan = [...planSummaries(status)].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  const circumference = 2 * Math.PI * 34
  const pct = plan ? Math.max(0, plan.percentUsed) : 0
  const [animatedPct, setAnimatedPct] = useState(0)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimatedPct(Math.min(100, pct)))
    return () => cancelAnimationFrame(frame)
  }, [pct])

  const severity = pct < 70 ? 'ok' : pct < 90 ? 'warn' : 'bad'
  return (
    <div className="ov-card ov-fuel">
      <div className="ov-fuel-head">
        <span className="ov-label">Nearest limit</span>
        <button className="ov-link" type="button" onClick={() => onNavigate?.('plans')}>Plans →</button>
      </div>
      {plan ? (
        <>
          <div className="ov-ring-wrap">
            <svg className="ov-ring" viewBox="0 0 80 80" aria-label={`${Math.round(pct)} percent used`}>
              <circle className="ov-ring-track" cx="40" cy="40" r="34" />
              <circle
                className={`ov-ring-fill ${severity}`}
                cx="40"
                cy="40"
                r="34"
                data-pct={pct}
                style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - animatedPct / 100) }}
              />
            </svg>
            <div className="ov-ring-c"><div className="ov-ring-pct">{Math.round(pct)}%</div><div className="ov-ring-lbl">used</div></div>
          </div>
          <div className="ov-fuel-meta">
            <div className="ov-fuel-name">{PLAN_NAMES[plan.id]}</div>
            <div className="ov-fuel-reset">resets in {plan.daysUntilReset}d</div>
          </div>
        </>
      ) : (
        <div className="ov-fuel-empty">No budget set</div>
      )}
    </div>
  )
}

function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleString('en-US', { month: 'short', day: 'numeric' })
}

function DailyChart({ daily }: { daily: DailyHistoryEntry[] }) {
  const max = Math.max(...daily.map(day => day.cost), 0)
  const peakIndex = daily.reduce((peak, day, index) => day.cost > (daily[peak]?.cost ?? -1) ? index : peak, 0)
  const [tip, setTip] = useState<{ day: DailyHistoryEntry; left: number; top: number } | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const labels = daily.length ? [daily[0], daily[Math.floor((daily.length - 1) / 2)], daily[daily.length - 1]] : []

  return (
    <>
      <div className="chart" ref={chartRef}>
        {daily.map((day, index) => (
          <button
            type="button"
            aria-label={`${day.date}: ${formatUsd(day.cost)}`}
            className={`col${index === peakIndex ? ' hi' : ''}`}
            key={day.date}
            style={{ height: `${max > 0 ? Math.max(2, day.cost / max * 100) : 2}%` }}
            data-date={day.date}
            data-cost={day.cost}
            data-calls={day.calls}
            data-led={day.topModels[0]?.name ?? ''}
            onMouseEnter={event => {
              const rect = chartRef.current?.getBoundingClientRect()
              if (rect) setTip({ day, left: event.clientX - rect.left, top: event.clientY - rect.top - 14 })
            }}
            onMouseMove={event => {
              const rect = chartRef.current?.getBoundingClientRect()
              if (rect) setTip({ day, left: event.clientX - rect.left, top: event.clientY - rect.top - 14 })
            }}
            onMouseLeave={() => setTip(null)}
          />
        ))}
        <div className={`chart-tip${tip ? ' on' : ''}`} style={tip ? { left: tip.left, top: tip.top } : undefined}>
          {tip && <><div className="chart-tip-d">{formatDay(tip.day.date)}</div><div className="chart-tip-v">{formatUsd(tip.day.cost)}</div><div className="chart-tip-s">{tip.day.calls} calls · {tip.day.topModels[0]?.name ?? 'No model'} led</div></>}
        </div>
      </div>
      <div className="ov-xax">{labels.map((day, index) => <span key={`${day.date}-${index}`}>{formatDay(day.date)}</span>)}</div>
    </>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>{children}</p>
}

export function Overview({ period, provider }: { period: Period; provider: string }) {
  const overview = usePolled<MenubarPayload>(() => codeburn.getOverview(period, provider), [period, provider])
  return <OverviewContent period={period} overview={overview} />
}

export function OverviewContent({
  period,
  overview,
  onNavigate,
}: {
  period: Period
  overview: Polled<MenubarPayload>
  onNavigate?: (section: 'plans' | 'optimize') => void
}) {
  const plans = usePolled<StatusJson>(() => codeburn.getPlans(period), [period])
  const actReport = usePolled<ActReportJson>(() => codeburn.getActReport(), [])
  const { data, error } = overview
  const modelIndex = useMemo(() => data ? buildModelIndex(data) : new Map<string, string>(), [data])

  if (!data) {
    if (error) return <CliErrorPanel error={error} subject="your usage" />
    return <Panel title="Overview"><EmptyNote>Scanning sessions…</EmptyNote></Panel>
  }

  const now = new Date()
  const stats = deriveStats(data, now)
  const periodDaily = sliceDailyToPeriod(data.history.daily, period, now)
  const recent14 = data.history.daily.slice(-14)
  const dailyAverage = mean(periodDaily.map(day => day.cost))
  const averageDelta = dailyAverage > 0 ? ((stats.todayCost - dailyAverage) / dailyAverage) * 100 : 0
  const comparison = averageDelta <= 0 ? 'under' : 'over'
  const weekNow = mean(recent14.slice(-7).map(day => day.cost))
  const weekPrior = mean(recent14.slice(-14, -7).map(day => day.cost))
  const weeklyPct = weekPrior > 0 ? Math.round(Math.abs((weekNow - weekPrior) / weekPrior * 100)) : null
  const weeklyDirection = weekNow >= weekPrior ? 'higher' : 'lower'
  const topModel = data.current.topModels[0]
  const saved = actReport.data?.totals.realizedCostUSD ?? 0
  const applied = saved > 0 ? (actReport.data?.totals.measuredActions ?? 0) : 0
  const cumulativeSavings = data.history.daily.reduce<number[]>((values, day) => {
    values.push((values.at(-1) ?? 0) + day.savingsUSD)
    return values
  }, []).slice(-14)

  return (
    <>
      <div className="ov-hero-row">
        <div className="ov-card ov-hero">
          <div className="ov-hero-top"><span className="ov-label">Today's burn</span><span className="ov-streak"><b>{streakDays(data.history.daily, now)}</b>-day streak</span></div>
          <CountUp value={stats.todayCost} />
          <div className="ov-hero-sub">
            {stats.todayEntry?.calls ?? 0} calls · <span className={comparison === 'under' ? 'ok' : 'neutral'}>{Math.abs(Math.round(averageDelta))}% {comparison}</span> your daily average of {formatUsd(dailyAverage)}
          </div>
          <Sparkline values={recent14.map(day => day.cost)} hero />
        </div>
        <FuelRing status={plans.data} onNavigate={onNavigate} />
      </div>

      <div className="ov-coach">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>
        <div className="ov-coach-tx">
          {weeklyPct === null ? <>No prior-week pacing baseline yet</> : <>You're pacing <span className="num">{weeklyPct}% {weeklyDirection}</span> than last week</>}{topModel ? <>; <span className="num">{topModel.name}</span> is the biggest driver</> : ''}. <span className="num">{formatUsd(data.optimize.savingsUSD)}</span> is recoverable.
        </div>
        <button className="ov-coach-cta" type="button" onClick={() => onNavigate?.('optimize')}>Review →</button>
      </div>

      <div className="ov-stats3">
        <div className="ov-card ov-stat"><div className="ov-label">Month to date</div><div className="v">{formatUsd(stats.mtd)}</div><div className="d">{stats.pacePct === null ? `No ${stats.prevMonthName} pace yet` : `${stats.pacePct >= 0 ? '+' : ''}${Math.round(stats.pacePct)}% vs ${stats.prevMonthName} pace`}</div><Sparkline values={data.history.daily.filter(day => day.date.startsWith(localDateKey(now).slice(0, 7))).map(day => day.cost)} /></div>
        <div className="ov-card ov-stat"><div className="ov-label">Projected month</div><div className="v">{formatUsd(stats.projected)} <small>est</small></div><div className="d warn">{formatUsd(Math.max(0, stats.projected - stats.mtd))} to go</div><Sparkline values={recent14.map(day => day.cost)} /></div>
        <div className="ov-card ov-stat"><div className="ov-label">Saved to date</div><div className="v" style={{ color: 'var(--ok)' }}>{formatUsd(saved)}</div><div className="d ok">from {applied} applied fixes</div><Sparkline values={cumulativeSavings} ok /></div>
      </div>

      <div className="ov-card ov-panel">
        <div className="ov-panel-head"><h3>Daily spend</h3><span className="r">{topModel ? `Biggest driver: ${topModel.name}` : 'No model driver yet'}</span></div>
        <div className="ov-panel-body">{periodDaily.length ? <DailyChart daily={periodDaily} /> : <EmptyNote>No spend in this range yet.</EmptyNote>}</div>
      </div>

      <div className="ov-card ov-panel">
        <div className="ov-panel-head"><h3>Most expensive sessions</h3><span className="r"><button className="ov-link" type="button">See all →</button></span></div>
        <div className="ov-panel-body">
          {data.current.topSessions.length ? data.current.topSessions.map((session, index) => {
            const model = modelIndex.get(sessionModelKey(session.project, session.date, session.calls, session.cost))
            const sub = [formatDay(session.date), model, `${session.calls} calls`].filter(Boolean).join(' · ')
            return <ListRow key={`${session.project}-${session.date}-${index}`} no={String(index + 1).padStart(2, '0')} dotColor={seriesColorForModel(model)} title={session.project} sub={sub} value={formatUsd(session.cost)} />
          }) : <EmptyNote>No sessions in this range.</EmptyNote>}
        </div>
      </div>
    </>
  )
}
