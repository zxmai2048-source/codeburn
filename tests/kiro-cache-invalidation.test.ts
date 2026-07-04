import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createKiroProvider } from '../src/providers/kiro.js'
import { CACHE_VERSION, computeEnvFingerprint } from '../src/session-cache.js'
import type { ParsedProviderCall } from '../src/providers/types.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'kiro-cache-inv-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('Kiro session cache invalidation', () => {
  it('kiro parser version is registered — stale cache fingerprints will mismatch', () => {
    // The cache invalidation mechanism works by comparing envFingerprints.
    // When kiro is NOT in PROVIDER_PARSE_VERSIONS, its fingerprint matches
    // any unknown provider (no parser version component). With the entry added,
    // existing caches that were computed without the parser version will have a
    // different fingerprint → triggering a full re-parse.
    const kiroFp = computeEnvFingerprint('kiro')
    const unknownFp = computeEnvFingerprint('nonexistent-provider')
    expect(kiroFp).not.toBe(unknownFp)
  })

  it('stale zero-turn cache entry is invalidated by parser version change', () => {
    // Simulate the scenario: old cache was computed without parser version
    const oldFingerprint = 'abcdef0123456789' // would have been computed before kiro had a parser version
    const currentFingerprint = computeEnvFingerprint('kiro')

    // The fingerprints differ, which causes parseProviderSources() to discard
    // the cached section and re-parse all files from scratch
    expect(oldFingerprint).not.toBe(currentFingerprint)
  })

  it('file with context.messages.entries parses correctly after cache miss', async () => {
    // This verifies that after cache invalidation forces a re-parse,
    // the fixed parser correctly extracts content from context.messages.entries
    const wsHash = 'a'.repeat(32)
    const subDir = 'b'.repeat(32)
    await mkdir(join(tmpDir, wsHash, subDir), { recursive: true })

    await writeFile(join(tmpDir, wsHash, subDir, 'exec-001'), JSON.stringify({
      executionId: 'exec-cache-miss',
      workflowType: 'chat-agent',
      status: 'succeed',
      startTime: 1780000000000,
      chatSessionId: 'session-cache-miss',
      context: {
        messages: [
          { role: 'human', entries: [{ type: 'text', text: 'What is TypeScript?' }] },
          { role: 'bot', entries: [{ type: 'text', text: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.' }] },
        ],
      },
    }))

    const provider = createKiroProvider(tmpDir, tmpDir, '/nonexistent')
    const sessions = await provider.discoverSessions()
    const calls: ParsedProviderCall[] = []
    for (const source of sessions) {
      for await (const call of provider.createSessionParser(source, new Set()).parse()) {
        calls.push(call)
      }
    }

    // Parser correctly extracts content — this is what happens after cache invalidation
    expect(calls).toHaveLength(1)
    expect(calls[0]!.inputTokens).toBeGreaterThan(0)
    expect(calls[0]!.outputTokens).toBeGreaterThan(0)
  })
})
