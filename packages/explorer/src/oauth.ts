import { isJsonMediaType } from '@davidniessen/doctopus-contracts';

export interface OAuthClient {
  clientId: string;
  issuer: string;
  authorizationUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
  allowLoopbackHttp?: boolean;
}
export interface PkceTransaction {
  client: OAuthClient;
  state: string;
  verifier: string;
  authorizationUrl: string;
  expiresAt: number;
}
export interface OAuthAccessToken {
  accessToken: string;
  expiresAt?: number;
}
const base64url = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const consumed = new WeakSet<PkceTransaction>();
const hasControl = (value: string): boolean =>
  Array.from(value).some(
    (character) =>
      character.codePointAt(0)! < 32 || character.codePointAt(0) === 127,
  );
export function oauthUrl(value: string, allowLoopbackHttp = false): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        allowLoopbackHttp &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error(
      'OAuth endpoints require HTTPS; explicit loopback HTTP is for local development only.',
    );
  return url;
}
export function resolveOAuthEndpoint(endpoint: string, server: string): string {
  const base = new URL(server);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error(
      'Configure an HTTP(S) API server without credentials, query or fragment.',
    );
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(endpoint, base).href;
}
export async function calculatePkceChallenge(
  verifier: string,
): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
    throw new Error('Invalid PKCE verifier');
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  );
}
/** Contains sensitive transient values. Keep this transaction in memory and never log it. */
export async function createPkceTransaction(
  input: OAuthClient,
): Promise<PkceTransaction> {
  const client = structuredClone(input);
  if (
    !client.clientId.trim() ||
    client.clientId.length > 1024 ||
    hasControl(client.clientId)
  )
    throw new Error('A public OAuth client ID is required.');
  const authorization = oauthUrl(
    client.authorizationUrl,
    client.allowLoopbackHttp,
  );
  oauthUrl(client.tokenUrl, client.allowLoopbackHttp);
  const redirect = oauthUrl(client.redirectUri, client.allowLoopbackHttp);
  const issuer = oauthUrl(client.issuer, client.allowLoopbackHttp);
  if (redirect.search || issuer.search)
    throw new Error('OAuth redirect and issuer URLs cannot contain a query.');
  if (
    client.scopes.length > 100 ||
    client.scopes.some(
      (scope) => !/^[\x21\x23-\x5b\x5d-\x7e]{1,256}$/.test(scope),
    )
  )
    throw new Error('Invalid OAuth scopes.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  for (const [name, value] of Object.entries({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: [...new Set(client.scopes)].join(' '),
    state,
    code_challenge_method: 'S256',
    code_challenge: await calculatePkceChallenge(verifier),
  }))
    authorization.searchParams.set(name, value);
  return {
    client,
    state,
    verifier,
    authorizationUrl: authorization.href,
    expiresAt: Date.now() + 5 * 60_000,
  };
}
async function tokenBody(response: Response): Promise<Record<string, unknown>> {
  if (
    !response.ok ||
    !isJsonMediaType(response.headers.get('content-type') ?? '')
  )
    throw new Error('OAuth token request failed.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty OAuth token response.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '',
    size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 64 * 1024)
        throw new Error('OAuth token response exceeds 64 KiB.');
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid OAuth token response.');
    return value as Record<string, unknown>;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function exchangePkceCode(
  transaction: PkceTransaction,
  parameters: URLSearchParams,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<OAuthAccessToken> {
  if (Date.now() >= transaction.expiresAt || consumed.has(transaction))
    throw new Error('OAuth transaction expired or was already consumed.');
  for (const name of ['state', 'code', 'iss', 'error'])
    if (parameters.getAll(name).length > 1)
      throw new Error('Duplicate OAuth callback parameter.');
  if (parameters.get('state') !== transaction.state)
    throw new Error('OAuth state did not match.');
  if (parameters.has('error'))
    throw new Error('OAuth authorization was denied or failed.');
  if (
    parameters.has('iss') &&
    parameters.get('iss') !== transaction.client.issuer
  )
    throw new Error('OAuth issuer did not match.');
  const code = parameters.get('code');
  if (!code || code.length > 4096 || hasControl(code))
    throw new Error('Invalid OAuth authorization code.');
  consumed.add(transaction);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      oauthUrl(
        transaction.client.tokenUrl,
        transaction.client.allowLoopbackHttp,
      ),
      {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: transaction.client.clientId,
          redirect_uri: transaction.client.redirectUri,
          code,
          code_verifier: transaction.verifier,
        }),
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new Error(
      'OAuth token request could not complete. Check CORS, endpoint configuration and network access.',
    );
  }
  let body: Record<string, unknown>;
  try {
    body = await tokenBody(response);
  } catch {
    throw new Error(
      'OAuth token response was invalid, unsuccessful or exceeded its size limit.',
    );
  }
  if (
    typeof body.access_token !== 'string' ||
    !body.access_token ||
    body.access_token.length > 16_384 ||
    hasControl(body.access_token) ||
    typeof body.token_type !== 'string' ||
    body.token_type.toLowerCase() !== 'bearer'
  )
    throw new Error('OAuth provider did not return a supported bearer token.');
  let expiresAt: number | undefined;
  if (body.expires_in !== undefined) {
    if (
      typeof body.expires_in !== 'number' ||
      !Number.isSafeInteger(body.expires_in) ||
      body.expires_in <= 0 ||
      body.expires_in > Math.floor((8.64e15 - Date.now()) / 1000)
    )
      throw new Error('OAuth provider returned an invalid token lifetime.');
    expiresAt = Date.now() + body.expires_in * 1000;
  }
  return {
    accessToken: body.access_token,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}
