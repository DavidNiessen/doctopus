import { describe, expect, it, vi } from 'vitest';
import {
  calculatePkceChallenge,
  createPkceTransaction,
  exchangePkceCode,
  oauthUrl,
  resolveOAuthEndpoint,
} from '@davidniessen/doctopus-explorer';
import type {
  OAuthClient,
  PkceTransaction,
} from '@davidniessen/doctopus-explorer';

const client: OAuthClient = {
  clientId: 'public-reader',
  issuer: 'https://auth.example.test',
  authorizationUrl: 'https://auth.example.test/authorize?audience=api',
  tokenUrl: 'https://auth.example.test/token',
  redirectUri: 'https://docs.example.test/reference/oauth/callback/',
  scopes: ['projects:read'],
};
const callback = (transaction: PkceTransaction) =>
  new URLSearchParams({
    code: 'fixture-code',
    state: transaction.state,
    iss: client.issuer,
  });
const response = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': type },
  });

describe('public-client OAuth PKCE', () => {
  it('resolves relative OAuth endpoints against the selected API server', () => {
    expect(
      resolveOAuthEndpoint('oauth/authorize', 'https://api.example.test/v1'),
    ).toBe('https://api.example.test/v1/oauth/authorize');
    expect(
      resolveOAuthEndpoint('/oauth/token', 'https://api.example.test/v1'),
    ).toBe('https://api.example.test/oauth/token');
    expect(
      resolveOAuthEndpoint(
        'https://auth.example.test/token',
        'https://api.example.test/v1',
      ),
    ).toBe('https://auth.example.test/token');
    expect(() =>
      resolveOAuthEndpoint('/token', 'https://api.example.test?secret=value'),
    ).toThrow();
  });
  it('matches RFC 7636 and creates independent unpredictable transactions', async () => {
    expect(
      await calculatePkceChallenge(
        'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      ),
    ).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const first = await createPkceTransaction(client),
      second = await createPkceTransaction(client);
    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
    const params = new URL(first.authorizationUrl).searchParams;
    expect(params.get('code_challenge')).toBe(
      await calculatePkceChallenge(first.verifier),
    );
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('audience')).toBe('api');
    expect(params.get('redirect_uri')).toBe(client.redirectUri);
    expect(first.authorizationUrl).not.toContain(first.verifier);
  });
  it.each([
    'http://provider.example.test/token',
    'http://127.0.0.1.evil.test/token',
    'https://user:password@provider.example.test/token',
    'https://provider.example.test/token#secret',
    'javascript:alert(1)',
  ])('rejects an unsafe endpoint %s', (url) =>
    expect(() => oauthUrl(url, true)).toThrow(),
  );
  it('permits HTTP only for explicitly enabled loopback development', () => {
    expect(() => oauthUrl('http://localhost/token')).toThrow();
    expect(oauthUrl('http://127.0.0.1/token', true).protocol).toBe('http:');
    expect(oauthUrl('http://[::1]/token', true).protocol).toBe('http:');
  });
  it('exchanges a code with PKCE, without client secrets, cookies or redirect following', async () => {
    const transaction = await createPkceTransaction(client);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        access_token: 'fixture-access',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: 'never-return-this',
        id_token: 'not-a-login-session',
      }),
    );
    const token = await exchangePkceCode(transaction, callback(transaction), {
      fetch: fetcher,
    });
    expect(token.accessToken).toBe('fixture-access');
    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(token).not.toHaveProperty('refresh_token');
    expect(token).not.toHaveProperty('id_token');
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(client.tokenUrl);
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    expect(options!.body).toBeInstanceOf(URLSearchParams);
    const body = options!.body as URLSearchParams;
    expect(body.get('code_verifier')).toBe(transaction.verifier);
    expect(body.get('client_id')).toBe(client.clientId);
    expect(body.has('client_secret')).toBe(false);
    await expect(
      exchangePkceCode(transaction, callback(transaction), { fetch: fetcher }),
    ).rejects.toThrow(/consumed/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['state', 'iss', 'duplicate', 'denied', 'missing-code', 'expired'])(
    'rejects %s before sending credentials',
    async (mode) => {
      const transaction = await createPkceTransaction(client),
        params = callback(transaction);
      if (mode === 'state') params.set('state', 'other');
      if (mode === 'iss') params.set('iss', 'https://other.example.test');
      if (mode === 'duplicate') params.append('code', 'another-code');
      if (mode === 'denied') {
        params.set('error', 'access_denied');
        params.set('error_description', 'sensitive-provider-marker');
      }
      if (mode === 'missing-code') params.delete('code');
      if (mode === 'expired') transaction.expiresAt = Date.now() - 1;
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        exchangePkceCode(transaction, params, { fetch: fetcher }),
      ).rejects.not.toThrow(/sensitive-provider-marker/);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    [
      { access_token: 'secret-marker', token_type: 'Mac' },
      200,
      'application/json',
    ],
    [
      { access_token: 'secret-marker', token_type: 'Bearer', expires_in: -1 },
      200,
      'application/json',
    ],
    [
      { access_token: 'secret-marker\n', token_type: 'Bearer' },
      200,
      'application/json',
    ],
    [
      { access_token: 'secret-marker', token_type: 'Bearer' },
      400,
      'application/json',
    ],
    [{ access_token: 'secret-marker', token_type: 'Bearer' }, 200, 'text/html'],
    [
      { access_token: 'secret-marker'.repeat(6000), token_type: 'Bearer' },
      200,
      'application/json',
    ],
  ] as const)(
    'bounds and validates token responses without reflecting values',
    async (body, status, type) => {
      const transaction = await createPkceTransaction(client);
      await expect(
        exchangePkceCode(transaction, callback(transaction), {
          fetch: vi
            .fn<typeof fetch>()
            .mockResolvedValue(response(body, status, type)),
        }),
      ).rejects.not.toThrow(/secret-marker/);
    },
  );
  it('does not expose arbitrary fetch exception details', async () => {
    const transaction = await createPkceTransaction(client);
    await expect(
      exchangePkceCode(transaction, callback(transaction), {
        fetch: vi
          .fn<typeof fetch>()
          .mockRejectedValue(new Error('secret-marker')),
      }),
    ).rejects.toThrow('OAuth token request could not complete.');
  });
});
