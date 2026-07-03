import { createInterface } from 'node:readline/promises'
import { homedir } from 'os'
import chalk from 'chalk'
import type { DateRange, ProjectSummary } from '../types.js'
import { scanAndDetect } from '../optimize.js'
import { formatCost } from '../currency.js'
import { formatTokens } from '../format.js'
import { runAction } from './apply.js'
import { shortId } from './journal.js'
import { planFindings, type FindingPlan, type PlanContext } from './plans.js'

export type ApplyOptions = {
  yes?: boolean
  dryRun?: boolean
  only?: string
  actionsDir?: string
  ctx?: PlanContext
}

function short(p: string): string {
  const home = homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

function changeLines(fp: FindingPlan): string[] {
  return fp.plan!.changes.map(c =>
    c.op === 'move' ? `${short(c.path)} -> ${short(c.movedTo)}` : short(c.path),
  )
}

export function renderApplyList(appliable: FindingPlan[], manual: FindingPlan[], costRate: number): string {
  const lines: string[] = ['']
  lines.push(chalk.bold('  Appliable config-class fixes:'))
  appliable.forEach((fp, i) => {
    const f = fp.finding
    const savings = `~${formatTokens(f.tokensSaved)} tokens${costRate > 0 ? `, ~${formatCost(f.tokensSaved * costRate)}` : ''}`
    lines.push('')
    lines.push(`  ${i + 1}. ${f.title}  ${chalk.hex('#FFD700')(`(${savings})`)}`)
    for (const line of changeLines(fp)) lines.push(chalk.dim(`       ${line}`))
    for (const note of fp.notes) lines.push(chalk.yellow(`       ! ${note}`))
  })
  if (manual.length > 0) {
    lines.push('')
    lines.push(chalk.dim('  Not auto-appliable (apply by hand):'))
    for (const fp of manual) lines.push(chalk.dim(`    - ${fp.finding.title}  [${fp.finding.id}]  manual`))
  }
  lines.push('')
  return lines.join('\n')
}

function selectPlans(answer: string, appliable: FindingPlan[]): FindingPlan[] {
  const a = answer.trim().toLowerCase()
  if (a === 'a' || a === 'all' || a === 'y' || a === 'yes') return appliable
  if (a === '' || a === 'q' || a === 'quit' || a === 'n' || a === 'no') return []
  const picked: FindingPlan[] = []
  for (const token of a.split(/[\s,]+/)) {
    const n = Number.parseInt(token, 10)
    if (Number.isInteger(n) && n >= 1 && n <= appliable.length && !picked.includes(appliable[n - 1]!)) {
      picked.push(appliable[n - 1]!)
    }
  }
  return picked
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

export async function runOptimizeApply(
  projects: ProjectSummary[],
  dateRange: DateRange | undefined,
  opts: ApplyOptions = {},
): Promise<void> {
  process.stderr.write(chalk.dim('  Analyzing your sessions...\n'))
  const { findings, costRate } = await scanAndDetect(projects, dateRange)
  const plans = planFindings(findings, opts.ctx)

  let appliable = plans.filter(p => p.plan !== null)
  const manual = plans.filter(p => p.plan === null)

  if (opts.only) {
    const wanted = new Set(opts.only.split(',').map(s => s.trim()).filter(Boolean))
    appliable = appliable.filter(p => wanted.has(p.finding.id))
  }

  if (appliable.length === 0) {
    console.log(chalk.dim('\n  No appliable config-class fixes for this period.\n'))
    return
  }

  console.log(renderApplyList(appliable, manual, costRate))

  if (opts.dryRun) {
    console.log(chalk.dim('  Dry run: nothing was changed.\n'))
    return
  }

  let selected = appliable
  if (!opts.yes) {
    const answer = await ask('  Apply all / pick numbers / quit  [a / 1 2 3 / q]: ')
    selected = selectPlans(answer, appliable)
    if (selected.length === 0) {
      console.log(chalk.dim('  Nothing applied.\n'))
      return
    }
  }

  console.log('')
  for (const fp of selected) {
    try {
      const record = await runAction(fp.plan!, opts.actionsDir)
      console.log(`  Applied ${chalk.bold(shortId(record.id))}  ${record.description}`)
      console.log(chalk.dim(`    Undo anytime: codeburn act undo ${shortId(record.id)}`))
    } catch (e) {
      console.error(chalk.red(`  Failed to apply ${fp.finding.id}: ${e instanceof Error ? e.message : String(e)}`))
      process.exitCode = 1
    }
  }
  console.log('')
}
