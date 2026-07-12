/**
 * codeburn sync — discovery document parser.
 *
 * Fetches and validates {baseUrl}/.well-known/codeburn-export.json
 */

export interface CodeburnDiscoveryDoc {
  version: number
  issuer: string
  client_id: string
  scopes: string[]
  traces_path: string
  max_batch_size: number
}

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscoveryError'
  }
}

const SUPPORTED_VERSION = 1

export function parseDiscoveryDoc(raw: unknown): CodeburnDiscoveryDoc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DiscoveryError('Discovery doc must be a JSON object')
  }

  const doc = raw as Record<string, unknown>

  // Version check
  const version = typeof doc.version === 'number' ? doc.version : 1
  if (version > SUPPORTED_VERSION) {
    throw new DiscoveryError(
      `This endpoint requires codeburn sync v${version}. Please update codeburn.`
    )
  }

  // Required fields
  const issuer = doc.issuer
  if (typeof issuer !== 'string' || !issuer) {
    throw new DiscoveryError('Discovery doc missing required field: issuer')
  }

  const client_id = doc.client_id
  if (typeof client_id !== 'string' || !client_id) {
    throw new DiscoveryError('Discovery doc missing required field: client_id')
  }

  // Optional with defaults
  const scopes = Array.isArray(doc.scopes)
    ? doc.scopes.filter((s): s is string => typeof s === 'string')
    : ['openid']

  const traces_path = typeof doc.traces_path === 'string' ? doc.traces_path : '/v1/traces'

  const max_batch_size = typeof doc.max_batch_size === 'number' && doc.max_batch_size > 0
    ? doc.max_batch_size
    : 1000

  return { version, issuer, client_id, scopes, traces_path, max_batch_size }
}

export async function fetchDiscoveryDoc(baseUrl: string): Promise<CodeburnDiscoveryDoc> {
  const url = `${baseUrl.replace(/\/$/, '')}/.well-known/codeburn-export.json`

  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    throw new DiscoveryError(`Cannot reach ${url}: ${(err as Error).message}`)
  }

  if (response.status === 404) {
    throw new DiscoveryError(
      `Server does not support codeburn sync.\n${url} returned 404.`
    )
  }

  if (!response.ok) {
    throw new DiscoveryError(`${url} returned HTTP ${response.status}`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new DiscoveryError(`${url} returned invalid JSON`)
  }

  return parseDiscoveryDoc(body)
}
