import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@davidniessen/doctopus-spec';
import { buildSite } from '@davidniessen/doctopus-cli';
import { verifyArtifact } from '@davidniessen/doctopus-compiler';

const base = {
  name: 'OAuth docs',
  specs: [{ id: 'api', path: 'openapi.json' }],
};
describe('static OAuth publication', () => {
  it('accepts public clients and rejects client-secret configuration', () => {
    const client = {
      clientId: 'public-reader',
      issuer: 'https://auth.example.test',
    };
    expect(
      parseConfig({
        ...base,
        explorer: { oauthClients: { api: { oauth: client } } },
      }).explorer?.oauthClients?.api?.oauth,
    ).toEqual(client);
    expect(() =>
      parseConfig({
        ...base,
        explorer: {
          oauthClients: {
            api: { oauth: { ...client, clientSecret: 'fixture-only' } },
          },
        },
      }),
    ).toThrow();
  });
  it.each([
    'https://auth.example.test?secret=value',
    'https://auth.example.test#fragment',
    'https://user:password@auth.example.test',
    'http://auth.example.test',
    'not a URL',
  ])(
    'rejects an unsafe issuer %s during configuration validation',
    (issuer) => {
      expect(() =>
        parseConfig({
          ...base,
          explorer: {
            oauthClients: {
              api: { oauth: { clientId: 'public-reader', issuer } },
            },
          },
        }),
      ).toThrow();
    },
  );
  it('exports the callback as static files and preserves a publication when a redirect collides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-oauth-site-'));
    try {
      await writeFile(
        join(root, 'docs.config.yaml'),
        'name: OAuth docs\nbasePath: /reference\nspecs:\n  - id: api\n    path: openapi.json\n',
      );
      await writeFile(
        join(root, 'openapi.json'),
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'OAuth docs', version: 'v1' },
          paths: {},
        }),
      );
      const built = await buildSite(root);
      expect(built.manifest.routes).toContain('/oauth/callback/');
      const html = await readFile(
        join(built.directory, 'oauth/callback/index.html'),
        'utf8',
      );
      expect(html).toContain('noindex,nofollow');
      expect(html).toContain('no-referrer');
      expect(html).toContain('/reference/assets/oauth-callback.js');
      expect(
        await readFile(
          join(built.directory, 'assets/oauth-callback.js'),
          'utf8',
        ),
      ).toContain('replaceState');
      expect(
        await readFile(join(built.directory, 'search.json'), 'utf8'),
      ).not.toContain('oauth/callback');
      await writeFile(
        join(root, 'docs.config.yaml'),
        'name: OAuth docs\nbasePath: /reference\nspecs:\n  - id: api\n    path: openapi.json\nredirects:\n  /oauth/callback: /\n',
      );
      await expect(buildSite(root)).rejects.toThrow(/reserved OAuth callback/);
      expect((await verifyArtifact(built.directory)).artifactDigest).toBe(
        built.manifest.artifactDigest,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
