/**
 * codeburn sync — OIDC authentication.
 *
 * Authorization Code + PKCE flow with localhost callback server.
 */

import { createHash, randomBytes } from 'crypto'
import { createServer, type Server } from 'http'
import { URL } from 'url'

export interface OidcConfig {
  authorization_endpoint: string
  token_endpoint: string
  revocation_endpoint?: string
  scopes_supported?: string[]
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type: string
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

// --- OIDC Discovery ---

export async function fetchOidcConfig(issuer: string): Promise<OidcConfig> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`

  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    throw new AuthError(`Cannot reach OIDC discovery at ${url}: ${(err as Error).message}`)
  }

  if (!response.ok) {
    throw new AuthError(`OIDC discovery returned HTTP ${response.status}: ${url}`)
  }

  let body: Record<string, unknown>
  try {
    body = await response.json() as Record<string, unknown>
  } catch {
    throw new AuthError(`OIDC discovery returned invalid JSON: ${url}`)
  }

  const authorization_endpoint = body.authorization_endpoint
  const token_endpoint = body.token_endpoint
  if (typeof authorization_endpoint !== 'string' || typeof token_endpoint !== 'string') {
    throw new AuthError('OIDC discovery missing authorization_endpoint or token_endpoint')
  }

  return {
    authorization_endpoint,
    token_endpoint,
    revocation_endpoint: typeof body.revocation_endpoint === 'string' ? body.revocation_endpoint : undefined,
    scopes_supported: Array.isArray(body.scopes_supported)
      ? (body.scopes_supported as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined,
  }
}

// --- PKCE ---

export interface PkceChallenge {
  code_verifier: string
  code_challenge: string
  code_challenge_method: 'S256'
}

export function generatePkce(): PkceChallenge {
  // RFC 7636: 43-128 chars, unreserved characters
  const code_verifier = randomBytes(32).toString('base64url')
  const code_challenge = createHash('sha256').update(code_verifier).digest('base64url')
  return { code_verifier, code_challenge, code_challenge_method: 'S256' }
}

// --- Auth URL ---

export const CALLBACK_PORTS = [19876, 19877, 19878] as const

export interface AuthUrlParams {
  authorization_endpoint: string
  client_id: string
  redirect_uri: string
  scopes: string[]
  state: string
  pkce: PkceChallenge
}

export function buildAuthUrl(params: AuthUrlParams): string {
  const url = new URL(params.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.client_id)
  url.searchParams.set('redirect_uri', params.redirect_uri)
  url.searchParams.set('scope', params.scopes.join(' '))
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.pkce.code_challenge)
  url.searchParams.set('code_challenge_method', params.pkce.code_challenge_method)
  return url.toString()
}

export function resolveScopes(requestedScopes: string[], idpScopesSupported?: string[]): string[] {
  const scopes = [...requestedScopes]
  // Add offline_access only if the IdP advertises it
  if (idpScopesSupported?.includes('offline_access') && !scopes.includes('offline_access')) {
    scopes.push('offline_access')
  }
  return scopes
}

// --- Callback Server ---

export interface CallbackResult {
  code: string
  port: number
}

export function startCallbackServer(
  expectedState: string,
  timeoutMs: number = 300_000, // 5 minutes
): { promise: Promise<CallbackResult>; port: number; server: Server } {
  let resolvedPort = 0
  let server: Server

  const promise = new Promise<CallbackResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      server?.close()
      reject(new AuthError('Login timed out after 5 minutes. Please try again.'))
    }, timeoutMs)

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Login failed</h1><p>You can close this tab.</p></body></html>')
        clearTimeout(timer)
        server.close()
        reject(new AuthError(`IdP returned error: ${error}`))
        return
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid state parameter')
        return // don't close — might be a stale request
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Missing authorization code')
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h1>✓ Login successful</h1><p>You can close this tab.</p></body></html>')
      clearTimeout(timer)
      server.close()
      resolve({ code, port: resolvedPort })
    })

    // Try ports in order
    const tryListen = (ports: readonly number[], idx: number) => {
      if (idx >= ports.length) {
        clearTimeout(timer)
        reject(new AuthError(`All callback ports (${ports.join(', ')}) are in use. Close other codeburn instances and retry.`))
        return
      }
      const port = ports[idx]!
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          tryListen(ports, idx + 1)
        } else {
          clearTimeout(timer)
          reject(new AuthError(`Callback server error: ${err.message}`))
        }
      })
      server.listen(port, '127.0.0.1', () => {
        resolvedPort = port
      })
    }

    tryListen(CALLBACK_PORTS, 0)
  })

  // Return immediately so caller can read the port
  return { promise, port: resolvedPort, server: server! }
}

// --- Token Exchange ---

export async function exchangeCode(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    client_id: clientId,
  })

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    let detail = ''
    try { detail = await response.text() } catch {}
    throw new AuthError(`Token exchange failed (HTTP ${response.status}): ${detail}`)
  }

  const data = await response.json() as Record<string, unknown>
  if (typeof data.access_token !== 'string') {
    throw new AuthError('Token response missing access_token')
  }

  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    token_type: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
  }
}

export async function refreshToken(
  tokenEndpoint: string,
  refreshTokenValue: string,
  clientId: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    client_id: clientId,
  })

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    let detail = ''
    try { detail = await response.text() } catch {}
    if (response.status === 400 || response.status === 401) {
      throw new AuthError('Sync auth expired. Run `codeburn sync setup` to re-authenticate.')
    }
    throw new AuthError(`Token refresh failed (HTTP ${response.status}): ${detail}`)
  }

  const data = await response.json() as Record<string, unknown>
  if (typeof data.access_token !== 'string') {
    throw new AuthError('Refresh response missing access_token')
  }

  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    token_type: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
  }
}

export async function revokeToken(
  revocationEndpoint: string,
  token: string,
  clientId: string,
): Promise<void> {
  try {
    await fetch(revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, client_id: clientId }).toString(),
    })
  } catch {
    // Best-effort — don't fail logout if revocation endpoint is unavailable
  }
}
