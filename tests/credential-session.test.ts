import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCredentialSession,
  credentialScope,
  CREDENTIAL_MEMORY_MS,
} from '../apps/reader/src/credential-session.js';
import type { CredentialValues } from '../apps/reader/src/credential-session.js';
import type { SecurityScheme } from '@davidniessen/doctopus-contracts';
import { parseConfig } from '@davidniessen/doctopus-spec';
const api = {
  id: 'public',
  version: 'v1',
  securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
};
const operation = { security: [{ bearer: [] as string[] }] };
const server = 'https://api.example.test/v1';
const scope = () => credentialScope(api, operation, server);
const values = (value = 'private-fixture-token'): CredentialValues => ({
  bearer: { value },
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('destination-bound credential memory', () => {
  it('allows operators to disable reuse without enabling it through truthy configuration strings', () => {
    const config = {
      name: 'Fixture',
      specs: [{ id: 'api', path: 'openapi.yaml' }],
    };
    expect(
      parseConfig({ ...config, explorer: { credentialReuse: false } }).explorer
        ?.credentialReuse,
    ).toBe(false);
    expect(() =>
      parseConfig({ ...config, explorer: { credentialReuse: 'false' } }),
    ).toThrow();
  });
  it('starts empty and requires explicit consent before storing or reusing credentials', () => {
    const session = createCredentialSession();
    expect(session.isEnabled(scope())).toBe(false);
    expect(session.set(scope(), 'bearer', { value: 'not-consented' })).toBe(
      false,
    );
    expect(session.read(scope())).toEqual({});
    session.remember(scope(), values());
    expect(session.isEnabled(scope())).toBe(true);
    expect(session.read(scope())).toEqual(values());
    expect(JSON.stringify(session)).not.toContain('private-fixture-token');
    expect(createCredentialSession().read(scope())).toEqual({});
    session.clearAll();
  });
  it('separates API ids, versions and every destination component', () => {
    const session = createCredentialSession();
    session.remember(scope(), values());
    for (const destination of [
      'http://api.example.test/v1',
      'https://other.example.test/v1',
      'https://api.example.test:8443/v1',
      'https://api.example.test/v2',
    ])
      expect(
        session.read(credentialScope(api, operation, destination)),
      ).toEqual({});
    expect(
      session.read(credentialScope({ ...api, id: 'other' }, operation, server)),
    ).toEqual({});
    expect(
      session.read(
        credentialScope({ ...api, version: 'v2' }, operation, server),
      ),
    ).toEqual({});
    expect(
      session.read(
        credentialScope(api, operation, 'https://API.EXAMPLE.test:443/v1/'),
      ),
    ).toEqual(values());
    session.clearAll();
  });
  it('invalidates reuse when security placement, provider, public client or scope requirements change', () => {
    const oauth: SecurityScheme = {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://identity.example.test/authorize',
          tokenUrl: 'https://identity.example.test/token',
          scopes: { read: 'Read', profile: 'Profile', write: 'Write' },
        },
      },
    };
    const secured = { ...api, securitySchemes: { bearer: oauth } };
    const required = { security: [{ bearer: ['read', 'profile'] }] };
    const clients = {
      bearer: { clientId: 'reader', issuer: 'https://identity.example.test' },
    };
    const original = credentialScope(secured, required, server, clients);
    const session = createCredentialSession();
    session.remember(original, values());
    expect(
      session.read(
        credentialScope(
          secured,
          { security: [{ bearer: ['profile', 'read', 'read'] }] },
          server,
          clients,
        ),
      ),
    ).toEqual(values());
    expect(
      session.read(
        credentialScope(
          secured,
          { security: [{ bearer: ['write'] }] },
          server,
          clients,
        ),
      ),
    ).toEqual({});
    expect(
      session.read(
        credentialScope(secured, required, server, {
          bearer: { ...clients.bearer, clientId: 'other' },
        }),
      ),
    ).toEqual({});
    expect(
      session.read(
        credentialScope(secured, required, server, {
          bearer: { ...clients.bearer, issuer: 'https://other.example.test' },
        }),
      ),
    ).toEqual({});
    for (const replacement of [
      { type: 'apiKey', in: 'query', name: 'token' },
      { type: 'apiKey', in: 'header', name: 'X-Token' },
      {
        ...oauth,
        flows: {
          authorizationCode: { tokenUrl: 'https://other.example.test/token' },
        },
      },
    ])
      expect(
        session.read(
          credentialScope(
            { ...api, securitySchemes: { bearer: replacement } },
            required,
            server,
            clients,
          ),
        ),
      ).toEqual({});
    session.clearAll();
  });
  it.each([
    'ftp://api.example.test/v1',
    'https://user:password@api.example.test/v1',
    'https://api.example.test/v1?token=private',
    'https://api.example.test/v1#fragment',
    'invalid',
  ])(
    'does not retain credentials for an invalid destination: %s',
    (destination) => {
      const invalid = credentialScope(api, operation, destination);
      const session = createCredentialSession();
      expect(invalid.group).toBeUndefined();
      expect(() => session.remember(invalid, values())).toThrow(
        /valid destination/,
      );
      expect(session.hasRemembered()).toBe(false);
    },
  );
  it('expires provider tokens while a playground is closed and does not extend the consent window on edits', () => {
    const session = createCredentialSession();
    session.remember(scope(), {
      bearer: { value: 'oauth-fixture', expiresAt: Date.now() + 60_000 },
    });
    vi.advanceTimersByTime(61_000);
    expect(session.read(scope())).toEqual({});
    expect(session.isEnabled(scope())).toBe(true);
    vi.advanceTimersByTime(CREDENTIAL_MEMORY_MS - 62_000);
    expect(session.set(scope(), 'bearer', { value: 'late-edit' })).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(session.read(scope())).toEqual({});
    expect(session.isEnabled(scope())).toBe(false);
    expect(session.hasRemembered()).toBe(false);
  });
  it('never returns expired credentials even before throttled timers have executed', () => {
    const session = createCredentialSession();
    session.remember(scope(), {
      bearer: { value: 'short-lived', expiresAt: Date.now() + 1000 },
    });
    vi.setSystemTime(Date.now() + 2000);
    expect(session.read(scope())).toEqual({});
    vi.setSystemTime(Date.now() + CREDENTIAL_MEMORY_MS);
    expect(session.isEnabled(scope())).toBe(false);
    expect(session.read(scope())).toEqual({});
    session.clearAll();
  });
  it('clears every scope and advances the cancellation epoch even when empty', () => {
    const session = createCredentialSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.remember(scope(), values());
    session.remember(
      credentialScope({ ...api, id: 'other' }, operation, server),
      values('other-fixture'),
    );
    const before = session.getResetEpoch();
    session.clearAll();
    expect(session.getResetEpoch()).toBe(before + 1);
    expect(session.hasRemembered()).toBe(false);
    expect(session.read(scope())).toEqual({});
    session.clearAll();
    expect(session.getResetEpoch()).toBe(before + 2);
    expect(vi.getTimerCount()).toBe(0);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
  it('owns stored values and returned copies so callers cannot change an expiry or secret behind its back', () => {
    const session = createCredentialSession();
    const input = values();
    session.remember(scope(), input);
    input.bearer!.value = 'changed-input';
    const result = session.read(scope());
    result.bearer!.value = 'changed-output';
    result.bearer!.expiresAt = Date.now() - 1;
    expect(session.read(scope())).toEqual(values());
    session.clearAll();
  });
  it('handles literal prototype names without treating inherited properties as credentials', () => {
    const trickyApi = {
      ...api,
      securitySchemes: JSON.parse(
        '{"__proto__":{"type":"http","scheme":"bearer"},"constructor":{"type":"http","scheme":"basic"}}',
      ) as Record<string, SecurityScheme>,
    };
    const tricky = credentialScope(
      trickyApi,
      {
        security: [
          JSON.parse('{"__proto__":[],"constructor":[]}') as Record<
            string,
            string[]
          >,
        ],
      },
      server,
    );
    const session = createCredentialSession();
    session.remember(
      tricky,
      JSON.parse('{"__proto__":{"value":"own-token"}}') as CredentialValues,
    );
    const output = session.read(tricky);
    expect(output.__proto__?.value).toBe('own-token');
    expect(output.constructor).toBeUndefined();
    expect(Object.getPrototypeOf(output)).toBeNull();
    session.clearAll();
  });
  it('bounds destination and credential retention and rejects oversized values before remembering them', () => {
    const session = createCredentialSession();
    expect(() =>
      session.remember(scope(), values('x'.repeat(16 * 1024 + 1))),
    ).toThrow(/16 KiB/);
    expect(session.hasRemembered()).toBe(false);
    for (let index = 0; index < 9; index++)
      session.remember(
        credentialScope({ ...api, id: 'api-' + index }, operation, server),
        values(),
      );
    expect(
      session.read(credentialScope({ ...api, id: 'api-0' }, operation, server)),
    ).toEqual({});
    expect(
      session.read(credentialScope({ ...api, id: 'api-8' }, operation, server)),
    ).toEqual(values());
    const schemes = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [
        'key' + index,
        { type: 'http', scheme: 'bearer' },
      ]),
    );
    const requirements = Object.fromEntries(
      Object.keys(schemes).map((key) => [key, [] as string[]]),
    );
    const many = credentialScope(
      { ...api, securitySchemes: schemes },
      { security: [requirements] },
      server,
    );
    const entries = Object.fromEntries(
      Object.keys(schemes).map((key) => [key, { value: 'bounded-fixture' }]),
    );
    expect(() => session.remember(many, entries)).toThrow(
      /Too many credentials/,
    );
    session.clearAll();
  });
});
