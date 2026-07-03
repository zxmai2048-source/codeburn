import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { planFor, planFindings } from '../src/act/plans.js'
import { renderApplyList } from '../src/act/optimize-apply.js'
import { runAction } from '../src/act/apply.js'
import { undoAction } from '../src/act/undo.js'
import { readRecords } from '../src/act/journal.js'
import {
  detectBloatedClaudeMd,
  detectDuplicateReads,
  detectJunkReads,
  detectLowReadEditRatio,
  detectMcpToolCoverage,
} from '../src/optimize.js'
import type {
  FindingApply,
  FindingId,
  McpServerCoverage,
  ToolCall,
  WasteAction,
  WasteFinding,
} from '../src/optimize.js'

const roots: string[] = []

type Fixture = { root: string; home: string; project: string; actionsDir: string }

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'codeburn-optimize-apply-'))
  roots.push(root)
  const home = join(root, 'home')
  const project = join(root, 'project')
  await mkdir(home, { recursive: true })
  await mkdir(project, { recursive: true })
  return { root, home, project, actionsDir: join(root, 'actions') }
}

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

function makeFinding(id: FindingId, fix: WasteAction, apply?: FindingApply): WasteFinding {
  return { id, title: id, explanation: '', impact: 'medium', tokensSaved: 1000, fix, ...(apply ? { apply } : {}) }
}

const CMD_FIX: WasteAction = { type: 'command', label: '', text: '' }

async function hashTree(dir: string): Promise<string> {
  const h = createHash('sha256')
  async function walk(d: string): Promise<void> {
    const entries = (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        h.update('D:' + full + '\n')
        await walk(full)
      } else {
        h.update('F:' + full + '\n')
        h.update(await readFile(full))
      }
    }
  }
  await walk(dir)
  return h.digest('hex')
}

describe('mcp-remove plan', () => {
  it('deletes exactly the named server, leaves other keys untouched, and undo restores byte-identical', async () => {
    const fx = await makeFixture()
    const claudeJson = join(fx.home, '.claude.json')
    const original = JSON.stringify({
      mcpServers: { alpha: { command: 'a' }, beta: { command: 'b', args: ['x'] } },
      numFoo: 3,
      nested: { keep: true },
    }, null, 2) + '\n'
    await writeFile(claudeJson, original)
    await writeFile(join(fx.project, '.mcp.json'), JSON.stringify({ mcpServers: { gamma: {} } }, null, 2) + '\n')

    const finding = makeFinding('mcp-low-coverage', CMD_FIX, { kind: 'mcp-remove', servers: ['beta'] })
    const plan = planFor(finding, { homeDir: fx.home, cwd: fx.project })
    expect(plan).not.toBeNull()
    expect(plan!.changes).toHaveLength(1)
    expect(plan!.changes[0]!.path).toBe(claudeJson)

    const rec = await runAction(plan!, fx.actionsDir)

    const after = JSON.parse(await readFile(claudeJson, 'utf-8'))
    expect(after.mcpServers).toEqual({ alpha: { command: 'a' } })
    expect(after.numFoo).toBe(3)
    expect(after.nested).toEqual({ keep: true })
    // Untouched sibling config file.
    expect(JSON.parse(await readFile(join(fx.project, '.mcp.json'), 'utf-8')).mcpServers).toEqual({ gamma: {} })
    // 2-space indent + trailing newline contract.
    expect(await readFile(claudeJson, 'utf-8')).toBe(JSON.stringify(after, null, 2) + '\n')

    await undoAction({ id: rec.id }, { actionsDir: fx.actionsDir })
    expect(await readFile(claudeJson, 'utf-8')).toBe(original)
  })
})

describe('mcp-project-scope plan', () => {
  it('moves the entry from the global config into the keeper project .mcp.json, creating it when missing', async () => {
    const fx = await makeFixture()
    const claudeJson = join(fx.home, '.claude.json')
    const serverValue = { command: 'srv', args: ['--flag'], env: { A: '1' } }
    const original = JSON.stringify({ mcpServers: { srv: serverValue }, other: 1 }, null, 2) + '\n'
    await writeFile(claudeJson, original)

    const keeper = join(fx.root, 'keeper')
    await mkdir(keeper, { recursive: true })
    const keeperMcp = join(keeper, '.mcp.json')
    expect(existsSync(keeperMcp)).toBe(false)

    const finding = makeFinding('mcp-project-scope', { type: 'paste', destination: 'prompt', label: '', text: '' }, {
      kind: 'mcp-project-scope',
      servers: [{ server: 'srv', keepProjects: [keeper] }],
    })
    const plan = planFor(finding, { homeDir: fx.home, cwd: fx.project })
    expect(plan).not.toBeNull()

    const rec = await runAction(plan!, fx.actionsDir)

    expect(JSON.parse(await readFile(claudeJson, 'utf-8')).mcpServers).toEqual({})
    expect(existsSync(keeperMcp)).toBe(true)
    expect(JSON.parse(await readFile(keeperMcp, 'utf-8')).mcpServers).toEqual({ srv: serverValue })

    await undoAction({ id: rec.id }, { actionsDir: fx.actionsDir })
    expect(await readFile(claudeJson, 'utf-8')).toBe(original)
    expect(existsSync(keeperMcp)).toBe(false)
  })
})

describe('unparseable config file', () => {
  it('reports the parse error, skips that server, and still applies the servers it can read', async () => {
    const fx = await makeFixture()
    const claudeJson = join(fx.home, '.claude.json')
    await writeFile(claudeJson, JSON.stringify({ mcpServers: { good: { command: 'g' } } }, null, 2) + '\n')
    const brokenMcp = join(fx.project, '.mcp.json')
    await writeFile(brokenMcp, '{ this is not valid json,,, ')

    const finding = makeFinding('mcp-low-coverage', CMD_FIX, { kind: 'mcp-remove', servers: ['good', 'bad'] })
    const { plan, notes } = planFindings([finding], { homeDir: fx.home, cwd: fx.project })[0]!

    expect(notes.some(n => /could not parse/.test(n) && n.includes('.mcp.json'))).toBe(true)
    expect(notes.some(n => n.includes('bad'))).toBe(true)
    expect(plan).not.toBeNull()
    expect(plan!.changes.map(c => c.path)).toEqual([claudeJson])

    await runAction(plan!, fx.actionsDir)
    expect(JSON.parse(await readFile(claudeJson, 'utf-8')).mcpServers).toEqual({})
    // The broken file is left exactly as-is.
    expect(await readFile(brokenMcp, 'utf-8')).toBe('{ this is not valid json,,, ')
  })
})

describe('archive plan', () => {
  it('archives a skill dir and an agent file, round-trips undo, and suffixes a colliding name with -2', async () => {
    const fx = await makeFixture()
    const skillsDir = join(fx.home, '.claude', 'skills')
    const agentsDir = join(fx.home, '.claude', 'agents')
    await mkdir(join(skillsDir, 'foo'), { recursive: true })
    await writeFile(join(skillsDir, 'foo', 'SKILL.md'), 'skill body')
    // Pre-existing archive with the same name forces the -2 suffix.
    await mkdir(join(skillsDir, '.archived', 'foo'), { recursive: true })
    await writeFile(join(skillsDir, '.archived', 'foo', 'SKILL.md'), 'old archived')
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, 'bar.md'), 'agent body')

    const skillFinding = makeFinding('unused-skills', CMD_FIX, { kind: 'archive', names: ['foo'] })
    const skillPlan = planFor(skillFinding, { homeDir: fx.home, cwd: fx.project })
    expect(skillPlan!.changes[0]).toMatchObject({
      op: 'move',
      path: join(skillsDir, 'foo'),
      movedTo: join(skillsDir, '.archived', 'foo-2'),
    })
    const skillRec = await runAction(skillPlan!, fx.actionsDir)
    expect(existsSync(join(skillsDir, 'foo'))).toBe(false)
    expect(await readFile(join(skillsDir, '.archived', 'foo-2', 'SKILL.md'), 'utf-8')).toBe('skill body')
    // The pre-existing archive is preserved.
    expect(await readFile(join(skillsDir, '.archived', 'foo', 'SKILL.md'), 'utf-8')).toBe('old archived')

    const agentFinding = makeFinding('unused-agents', CMD_FIX, { kind: 'archive', names: ['bar'] })
    const agentPlan = planFor(agentFinding, { homeDir: fx.home, cwd: fx.project })
    expect(agentPlan!.changes[0]).toMatchObject({
      op: 'move',
      path: join(agentsDir, 'bar.md'),
      movedTo: join(agentsDir, '.archived', 'bar.md'),
    })
    const agentRec = await runAction(agentPlan!, fx.actionsDir)
    expect(existsSync(join(agentsDir, 'bar.md'))).toBe(false)

    await undoAction({ id: agentRec.id }, { actionsDir: fx.actionsDir })
    await undoAction({ id: skillRec.id }, { actionsDir: fx.actionsDir })
    expect(await readFile(join(agentsDir, 'bar.md'), 'utf-8')).toBe('agent body')
    expect(await readFile(join(skillsDir, 'foo', 'SKILL.md'), 'utf-8')).toBe('skill body')
    expect(existsSync(join(skillsDir, '.archived', 'foo-2'))).toBe(false)
  })
})

describe('claude-md rule plan', () => {
  it('appends a fresh marker block, replaces it in place on re-apply, and undo removes it', async () => {
    const fx = await makeFixture()
    const claudeMd = join(fx.project, 'CLAUDE.md')
    const original = '# Project\n\nExisting rules.\n'
    await writeFile(claudeMd, original)

    const first = makeFinding('read-edit-ratio', { type: 'paste', destination: 'claude-md', label: '', text: 'Read before editing.' })
    const firstPlan = planFor(first, { homeDir: fx.home, cwd: fx.project })
    const firstRec = await runAction(firstPlan!, fx.actionsDir)

    let body = await readFile(claudeMd, 'utf-8')
    expect(body).toContain('# Project')
    expect(body).toContain('<!-- codeburn:begin read-edit-ratio -->')
    expect(body).toContain('Read before editing.')
    expect(body).toContain('<!-- codeburn:end read-edit-ratio -->')

    // Second apply with the same id replaces the block instead of duplicating.
    const second = makeFinding('read-edit-ratio', { type: 'paste', destination: 'claude-md', label: '', text: 'Read first, then edit.' })
    const secondPlan = planFor(second, { homeDir: fx.home, cwd: fx.project })
    const secondRec = await runAction(secondPlan!, fx.actionsDir)

    body = await readFile(claudeMd, 'utf-8')
    expect(body.match(/codeburn:begin read-edit-ratio/g)).toHaveLength(1)
    expect(body).toContain('Read first, then edit.')
    expect(body).not.toContain('Read before editing.')

    await undoAction({ id: secondRec.id }, { actionsDir: fx.actionsDir })
    await undoAction({ id: firstRec.id }, { actionsDir: fx.actionsDir })
    expect(await readFile(claudeMd, 'utf-8')).toBe(original)
  })
})

describe('shell-config plan', () => {
  it('writes the bash cap inside # markers to the rc chosen from $SHELL', async () => {
    const fx = await makeFixture()
    const finding = makeFinding('bash-output-cap', { type: 'paste', destination: 'shell-config', label: '', text: 'export BASH_MAX_OUTPUT_LENGTH=15000' })
    const plan = planFor(finding, { homeDir: fx.home, cwd: fx.project, shell: '/bin/zsh' })
    expect(plan!.changes[0]!.path).toBe(join(fx.home, '.zshrc'))

    await runAction(plan!, fx.actionsDir)
    const body = await readFile(join(fx.home, '.zshrc'), 'utf-8')
    expect(body).toBe('# codeburn:begin bash-output-cap\nexport BASH_MAX_OUTPUT_LENGTH=15000\n# codeburn:end bash-output-cap\n')
  })
})

describe('dry-run', () => {
  it('leaves the fixture tree byte-identical when only planning', async () => {
    const fx = await makeFixture()
    await writeFile(join(fx.home, '.claude.json'), JSON.stringify({ mcpServers: { s: { command: 'c' } } }, null, 2) + '\n')
    await mkdir(join(fx.home, '.claude', 'skills', 'ghost'), { recursive: true })
    await writeFile(join(fx.home, '.claude', 'skills', 'ghost', 'SKILL.md'), 'x')
    await writeFile(join(fx.project, 'CLAUDE.md'), '# rules\n')

    const findings: WasteFinding[] = [
      makeFinding('mcp-low-coverage', CMD_FIX, { kind: 'mcp-remove', servers: ['s'] }),
      makeFinding('unused-skills', CMD_FIX, { kind: 'archive', names: ['ghost'] }),
      makeFinding('read-edit-ratio', { type: 'paste', destination: 'claude-md', label: '', text: 'rule' }),
      makeFinding('bash-output-cap', { type: 'paste', destination: 'shell-config', label: '', text: 'export BASH_MAX_OUTPUT_LENGTH=15000' }),
    ]

    const before = await hashTree(fx.root)
    const plans = planFindings(findings, { homeDir: fx.home, cwd: fx.project, shell: '/bin/zsh' })
    // Exercise the exact rendering the dry-run path prints.
    renderApplyList(plans.filter(p => p.plan !== null), plans.filter(p => p.plan === null), 0.000002)
    const after = await hashTree(fx.root)

    expect(plans.every(p => p.plan !== null)).toBe(true)
    expect(after).toBe(before)
  })
})

describe('finding-id regression guard', () => {
  const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
  const KNOWN: ReadonlySet<FindingId> = new Set<FindingId>([
    'read-edit-ratio', 'build-folder-reads', 'redundant-rereads', 'warmup-heavy',
    'unused-mcp', 'mcp-low-coverage', 'mcp-project-scope', 'retry-heavy-capabilities',
    'low-worth-sessions', 'context-heavy-sessions', 'cost-outliers', 'claude-md-too-long',
    'bash-output-cap', 'unused-agents', 'unused-skills', 'unused-commands',
  ])

  it('every finding produced by a detector run carries a stable, known, non-empty id', async () => {
    const fx = await makeFixture()
    const bigClaudeMd = '# Rules\n' + Array.from({ length: 260 }, (_, i) => `- rule ${i}`).join('\n') + '\n'
    await writeFile(join(fx.project, 'CLAUDE.md'), bigClaudeMd)

    function read(file: string, session = 's1'): ToolCall {
      return { name: 'Read', input: { file_path: file }, sessionId: session, project: 'p' }
    }
    const calls: ToolCall[] = [
      read('/p/node_modules/a.js'), read('/p/node_modules/b.js'), read('/p/dist/c.js'),
      ...Array.from({ length: 6 }, () => read('/p/src/app.ts')),
      ...Array.from({ length: 10 }, (): ToolCall => ({ name: 'Edit', input: {}, sessionId: 's1', project: 'p' })),
    ]
    const coverage: McpServerCoverage[] = [{
      server: 'x', toolsAvailable: 20, toolsInvoked: 1,
      unusedTools: Array.from({ length: 19 }, (_, i) => `mcp__x__t${i}`),
      invocations: 1, loadedSessions: 3, coverageRatio: 0.05,
    }]

    const findings = [
      detectLowReadEditRatio(calls),
      detectJunkReads(calls),
      detectDuplicateReads(calls),
      detectBloatedClaudeMd(new Set([fx.project])),
      detectMcpToolCoverage([], coverage),
    ].filter((f): f is WasteFinding => f !== null)

    expect(findings.length).toBeGreaterThanOrEqual(5)
    for (const f of findings) {
      expect(f.id).toBeTruthy()
      expect(f.id).toMatch(KEBAB)
      expect(KNOWN.has(f.id)).toBe(true)
    }
    const ids = findings.map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
