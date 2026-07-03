import { existsSync, readFileSync } from 'fs'
import { isAbsolute, join } from 'path'
import { homedir } from 'os'
import type { ActionKind, ActionPlan, PlannedChange } from './types.js'
import type { WasteFinding } from '../optimize.js'

// Turns an optimize finding into a concrete, journaled file-mutation plan.
// Only config-class findings are appliable; everything else yields plan: null
// (shown as "manual" by the CLI). Every path is derived from an injectable
// context so tests can point the whole thing at a fixture home.

export type PlanContext = {
  homeDir?: string
  cwd?: string
  shell?: string
}

export type BuiltPlan = {
  plan: ActionPlan | null
  // Human-facing skip reasons and parse errors, surfaced in the apply summary.
  notes: string[]
}

export type FindingPlan = BuiltPlan & { finding: WasteFinding }

type ResolvedPaths = {
  homeDir: string
  cwd: string
  projectMcpJson: string
  projectSettings: string
  projectSettingsLocal: string
  userClaudeJson: string
  skillsDir: string
  agentsDir: string
  commandsDir: string
  projectClaudeMd: string
  shellRc: string
}

function resolvePaths(ctx: PlanContext): ResolvedPaths {
  const homeDir = ctx.homeDir ?? homedir()
  const cwd = ctx.cwd ?? process.cwd()
  const shell = ctx.shell ?? process.env['SHELL'] ?? ''
  return {
    homeDir,
    cwd,
    projectMcpJson: join(cwd, '.mcp.json'),
    projectSettings: join(cwd, '.claude', 'settings.json'),
    projectSettingsLocal: join(cwd, '.claude', 'settings.local.json'),
    userClaudeJson: join(homeDir, '.claude.json'),
    skillsDir: join(homeDir, '.claude', 'skills'),
    agentsDir: join(homeDir, '.claude', 'agents'),
    commandsDir: join(homeDir, '.claude', 'commands'),
    projectClaudeMd: join(cwd, 'CLAUDE.md'),
    shellRc: join(homeDir, /zsh/.test(shell) ? '.zshrc' : '.bashrc'),
  }
}

export function planFor(finding: WasteFinding, ctx: PlanContext = {}): ActionPlan | null {
  return buildPlan(finding, resolvePaths(ctx)).plan
}

export function planFindings(findings: WasteFinding[], ctx: PlanContext = {}): FindingPlan[] {
  const r = resolvePaths(ctx)
  return findings.map(finding => ({ finding, ...buildPlan(finding, r) }))
}

function buildPlan(finding: WasteFinding, r: ResolvedPaths): BuiltPlan {
  switch (finding.id) {
    case 'mcp-low-coverage': return buildMcpRemove(finding, r)
    case 'mcp-project-scope': return buildMcpProjectScope(finding, r)
    case 'unused-skills': return buildArchive(finding, r, 'skill')
    case 'unused-agents': return buildArchive(finding, r, 'agent')
    case 'unused-commands': return buildArchive(finding, r, 'command')
    case 'bash-output-cap': return buildShellConfig(finding, r)
    default:
      if (finding.fix.type === 'paste' && finding.fix.destination === 'claude-md') {
        return buildClaudeMdRule(finding, r)
      }
      return { plan: null, notes: [] }
  }
}

// ---------------------------------------------------------------------------
// MCP config editing (remove + project-scope)
// ---------------------------------------------------------------------------

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function shortPath(p: string, homeDir: string): string {
  return p.startsWith(homeDir) ? '~' + p.slice(homeDir.length) : p
}

// Config keys are the server's original name; coverage findings carry the
// runtime-normalized form (":" -> "_"). Match either.
function findServerKey(container: Record<string, unknown> | undefined, server: string): string | null {
  if (!container) return null
  for (const k of Object.keys(container)) {
    if (k === server || k.replace(/:/g, '_') === server) return k
  }
  return null
}

type DocState = { path: string; doc: Record<string, unknown>; existed: boolean; dirty: boolean }

// Reads each config file at most once, tracks parse errors, and emits one
// PlannedChange per file it actually mutated.
class ConfigDocs {
  private docs = new Map<string, DocState | null>()
  private errors = new Map<string, string>()
  constructor(private homeDir: string) {}

  load(path: string): DocState | null {
    if (this.docs.has(path)) return this.docs.get(path)!
    if (!existsSync(path)) {
      const state: DocState = { path, doc: {}, existed: false, dirty: false }
      this.docs.set(path, state)
      return state
    }
    let raw: string
    try {
      raw = readFileSync(path, 'utf-8')
    } catch (e) {
      this.errors.set(path, `could not read ${shortPath(path, this.homeDir)}: ${errMessage(e)}`)
      this.docs.set(path, null)
      return null
    }
    try {
      const doc = JSON.parse(raw) as Record<string, unknown>
      const state: DocState = { path, doc, existed: true, dirty: false }
      this.docs.set(path, state)
      return state
    } catch (e) {
      this.errors.set(path, `could not parse ${shortPath(path, this.homeDir)}: ${errMessage(e)}`)
      this.docs.set(path, null)
      return null
    }
  }

  changes(): PlannedChange[] {
    const out: PlannedChange[] = []
    for (const state of this.docs.values()) {
      if (state && state.dirty) {
        out.push({
          op: state.existed ? 'edit' : 'create',
          path: state.path,
          content: JSON.stringify(state.doc, null, 2) + '\n',
        })
      }
    }
    return out
  }

  errorNotes(): string[] {
    return [...this.errors.values()]
  }
}

function serverContainers(state: DocState, isUserClaudeJson: boolean): Array<Record<string, unknown>> {
  const containers: Array<Record<string, unknown>> = []
  const top = state.doc.mcpServers
  if (top && typeof top === 'object') containers.push(top as Record<string, unknown>)
  if (isUserClaudeJson) {
    const projects = state.doc.projects
    if (projects && typeof projects === 'object') {
      for (const entry of Object.values(projects as Record<string, unknown>)) {
        const pm = (entry as Record<string, unknown> | null)?.['mcpServers']
        if (pm && typeof pm === 'object') containers.push(pm as Record<string, unknown>)
      }
    }
  }
  return containers
}

function deleteServer(state: DocState, server: string, isUserClaudeJson: boolean): boolean {
  let removed = false
  for (const container of serverContainers(state, isUserClaudeJson)) {
    const key = findServerKey(container, server)
    if (key) {
      delete container[key]
      state.dirty = true
      removed = true
    }
  }
  return removed
}

function readServerValue(state: DocState, server: string, isUserClaudeJson: boolean): unknown {
  for (const container of serverContainers(state, isUserClaudeJson)) {
    const key = findServerKey(container, server)
    if (key) return container[key]
  }
  return undefined
}

function buildMcpRemove(finding: WasteFinding, r: ResolvedPaths): BuiltPlan {
  const servers = finding.apply?.kind === 'mcp-remove' ? finding.apply.servers : []
  const searchPaths = [r.projectMcpJson, r.projectSettings, r.projectSettingsLocal, r.userClaudeJson]
  const docs = new ConfigDocs(r.homeDir)
  const skips: string[] = []

  for (const server of servers) {
    let removed = false
    for (const path of searchPaths) {
      const state = docs.load(path)
      if (!state) continue
      if (deleteServer(state, server, path === r.userClaudeJson)) removed = true
    }
    if (!removed) skips.push(`skipped ${server}: not found in editable config (plugin or managed config?)`)
  }

  const changes = docs.changes()
  const notes = [...docs.errorNotes(), ...skips]
  if (changes.length === 0) return { plan: null, notes }
  return {
    plan: mcpPlan('mcp-remove', finding.id, `Remove ${changes.length === 1 ? 'an MCP server' : 'MCP servers'} from config`, changes),
    notes,
  }
}

function buildMcpProjectScope(finding: WasteFinding, r: ResolvedPaths): BuiltPlan {
  const entries = finding.apply?.kind === 'mcp-project-scope' ? finding.apply.servers : []
  const searchPaths = [r.projectMcpJson, r.projectSettings, r.projectSettingsLocal, r.userClaudeJson]
  const docs = new ConfigDocs(r.homeDir)
  const skips: string[] = []

  for (const { server, keepProjects } of entries) {
    const keepers = keepProjects.filter(p => isAbsolute(p))
    if (keepers.length === 0) {
      skips.push(`skipped ${server}: no absolute keeper project path to scope into`)
      continue
    }

    let value: unknown
    for (const path of searchPaths) {
      const state = docs.load(path)
      if (!state) continue
      const found = readServerValue(state, server, path === r.userClaudeJson)
      if (found !== undefined) { value = found; break }
    }
    if (value === undefined) {
      skips.push(`skipped ${server}: not found in editable config (plugin or managed config?)`)
      continue
    }

    const keeperMcpPaths = new Set(keepers.map(k => join(k, '.mcp.json')))
    for (const path of searchPaths) {
      if (keeperMcpPaths.has(path)) continue
      const state = docs.load(path)
      if (!state) continue
      deleteServer(state, server, path === r.userClaudeJson)
    }

    for (const keeper of keepers) {
      const state = docs.load(join(keeper, '.mcp.json'))
      if (!state) {
        skips.push(`skipped ${server} for ${keeper}: its .mcp.json could not be parsed`)
        continue
      }
      const existing = state.doc.mcpServers
      const mcpServers = existing && typeof existing === 'object'
        ? existing as Record<string, unknown>
        : (state.doc.mcpServers = {})
      mcpServers[server] = value
      state.dirty = true
    }
  }

  const changes = docs.changes()
  const notes = [...docs.errorNotes(), ...skips]
  if (changes.length === 0) return { plan: null, notes }
  return {
    plan: mcpPlan('mcp-project-scope', finding.id, `Project-scope ${entries.length === 1 ? 'an MCP server' : 'MCP servers'}`, changes),
    notes,
  }
}

function mcpPlan(kind: ActionKind, findingId: string, description: string, changes: PlannedChange[]): ActionPlan {
  return { kind, findingId, description, changes }
}

// ---------------------------------------------------------------------------
// Archive unused skills / agents / commands
// ---------------------------------------------------------------------------

const ARCHIVE_KIND: Record<'skill' | 'agent' | 'command', ActionKind> = {
  skill: 'archive-skill',
  agent: 'archive-agent',
  command: 'archive-command',
}

function withSuffix(base: string, n: number): string {
  const dot = base.lastIndexOf('.')
  return dot === -1 ? `${base}-${n}` : `${base.slice(0, dot)}-${n}${base.slice(dot)}`
}

function buildArchive(finding: WasteFinding, r: ResolvedPaths, capability: 'skill' | 'agent' | 'command'): BuiltPlan {
  const names = finding.apply?.kind === 'archive' ? finding.apply.names : []
  const baseDir = capability === 'skill' ? r.skillsDir : capability === 'agent' ? r.agentsDir : r.commandsDir
  const isDir = capability === 'skill'
  const archivedDir = join(baseDir, '.archived')
  const changes: PlannedChange[] = []
  const notes: string[] = []
  const claimed = new Set<string>()

  for (const name of names) {
    const source = isDir ? join(baseDir, name) : join(baseDir, `${name}.md`)
    if (!existsSync(source)) {
      notes.push(`skipped ${name}: ${shortPath(source, r.homeDir)} no longer exists`)
      continue
    }
    const destBase = isDir ? name : `${name}.md`
    let dest = join(archivedDir, destBase)
    let n = 2
    while (existsSync(dest) || claimed.has(dest)) {
      dest = join(archivedDir, withSuffix(destBase, n))
      n++
    }
    claimed.add(dest)
    changes.push({ op: 'move', path: source, movedTo: dest })
  }

  if (changes.length === 0) return { plan: null, notes }
  return {
    plan: {
      kind: ARCHIVE_KIND[capability],
      findingId: finding.id,
      description: `Archive ${changes.length} unused ${capability}${changes.length === 1 ? '' : 's'}`,
      changes,
    },
    notes,
  }
}

// ---------------------------------------------------------------------------
// Marker-block edits (CLAUDE.md rule, shell rc)
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function upsertMarkerBlock(existing: string | null, id: string, text: string, style: 'html' | 'hash'): string {
  const begin = style === 'html' ? `<!-- codeburn:begin ${id} -->` : `# codeburn:begin ${id}`
  const end = style === 'html' ? `<!-- codeburn:end ${id} -->` : `# codeburn:end ${id}`
  const block = `${begin}\n${text}\n${end}\n`
  if (!existing) return block
  const region = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`)
  if (region.test(existing)) return existing.replace(region, block)
  return existing.endsWith('\n') ? existing + block : existing + '\n' + block
}

function buildClaudeMdRule(finding: WasteFinding, r: ResolvedPaths): BuiltPlan {
  if (finding.fix.type !== 'paste') return { plan: null, notes: [] }
  const target = r.projectClaudeMd
  const existing = existsSync(target) ? readFileSync(target, 'utf-8') : null
  const content = upsertMarkerBlock(existing, finding.id, finding.fix.text, 'html')
  return {
    plan: {
      kind: 'claude-md-rule',
      findingId: finding.id,
      description: `Add the ${finding.id} rule block to ${shortPath(target, r.homeDir)}`,
      changes: [{ op: existing === null ? 'create' : 'edit', path: target, content }],
    },
    notes: [],
  }
}

function buildShellConfig(finding: WasteFinding, r: ResolvedPaths): BuiltPlan {
  if (finding.fix.type !== 'paste') return { plan: null, notes: [] }
  const target = r.shellRc
  const existing = existsSync(target) ? readFileSync(target, 'utf-8') : null
  const content = upsertMarkerBlock(existing, finding.id, finding.fix.text, 'hash')
  return {
    plan: {
      kind: 'shell-config',
      findingId: finding.id,
      description: `Set the bash output cap in ${shortPath(target, r.homeDir)}`,
      changes: [{ op: existing === null ? 'create' : 'edit', path: target, content }],
    },
    notes: [],
  }
}
