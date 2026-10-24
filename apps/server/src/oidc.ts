import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyInstance } from 'fastify';
import type { Repository } from '@davidniessen/doctopus-domain';
export interface OidcOptions {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  allowedHosts?: string[];
}
export const tokenHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
export function equalSecret(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(tokenHash(a)), Buffer.from(tokenHash(b)));
}
export async function registerOidc(
  app: FastifyInstance,
  repository: Repository,
  options: OidcOptions,
  publicUrl: string,
  development: boolean,
): Promise<void> {
  const issuer = new URL(options.issuer);
  const hosts = new Set([issuer.hostname, ...(options.allowedHosts ?? [])]);
  const allowed = (input: unknown): URL => {
    if (typeof input !== 'string') throw new Error('Invalid OIDC endpoint');
    const url = new URL(input);
    if (
      url.username ||
      url.password ||
      !hosts.has(url.hostname) ||
      (url.protocol !== 'https:' &&
        !(
          development &&
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(url.hostname)
        ))
    )
      throw new Error(
        'OIDC endpoints must use HTTPS and an operator-approved host',
      );
    return url;
  };
  allowed(options.issuer);
  const readJson = async (
    url: URL,
    init?: RequestInit,
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('OIDC provider request failed');
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (response.body)
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > 1024 * 1024) {
          throw new Error('OIDC response exceeds 1 MiB');
        }
        chunks.push(chunk);
      }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
      string,
      unknown
    >;
  };
  const discovery = await readJson(
    allowed(
      `${options.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    ),
  );
  if (discovery.issuer !== options.issuer)
    throw new Error('OIDC discovery issuer does not match configuration');
  const authorization = allowed(discovery.authorization_endpoint);
  const token = allowed(discovery.token_endpoint);
  const jwks = createRemoteJWKSet(allowed(discovery.jwks_uri));
  const redirect = `${publicUrl}/auth/callback`;
  const secure = publicUrl.startsWith('https:');
  app.get('/auth/login', async (_request, reply) => {
    const state = random();
    const nonce = random();
    const verifier = random();
    await repository.saveOidc({
      stateHash: tokenHash(state),
      nonce,
      verifier,
      expiresAt: new Date(Date.now() + 600_000),
    });
    const url = new URL(authorization);
    url.searchParams.set('client_id', options.clientId);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set(
      'code_challenge',
      createHash('sha256').update(verifier).digest('base64url'),
    );
    url.searchParams.set('code_challenge_method', 'S256');
    reply.setCookie('docs_oidc', state, {
      path: '/auth',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 600,
    });
    return reply.redirect(url.href);
  });
  app.get<{ Querystring: { state?: string; code?: string } }>(
    '/auth/callback',
    async (request, reply) => {
      const { state, code } = request.query;
      if (
        !state ||
        !code ||
        state.length > 200 ||
        code.length > 4096 ||
        !request.cookies.docs_oidc ||
        !equalSecret(state, request.cookies.docs_oidc)
      )
        return reply.code(400).send({ error: 'Invalid authentication state' });
      reply.clearCookie('docs_oidc', { path: '/auth' });
      const transaction = await repository.consumeOidc(tokenHash(state));
      if (!transaction)
        return reply
          .code(400)
          .send({ error: 'Authentication expired or was already used' });
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
        code_verifier: transaction.verifier,
        client_id: options.clientId,
      });
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      if (options.clientSecret)
        headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`).toString('base64')}`;
      const tokens = await readJson(token, { method: 'POST', headers, body });
      if (typeof tokens.id_token !== 'string')
        return reply
          .code(400)
          .send({ error: 'Provider did not return an ID token' });
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: options.issuer,
        audience: options.clientId,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
      });
      if (payload.nonce !== transaction.nonce || !payload.sub)
        return reply.code(400).send({ error: 'Invalid authentication nonce' });
      const session = random();
      await repository.createSession(
        tokenHash(session),
        `${options.issuer}|${payload.sub}`,
        new Date(Math.min(Date.now() + 3_600_000, (payload.exp ?? 0) * 1000)),
      );
      reply.setCookie('docs_session', session, {
        path: '/',
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: 3600,
      });
      return reply.redirect('/admin/');
    },
  );
}
