import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { artifactIdentity } from '@davidniessen/doctopus-compiler';
import type { ArtifactManifest } from '@davidniessen/doctopus-contracts';
import { PublicationManifestCache } from '../apps/server/src/artifacts.js';
async function artifact(root: string, value = 'one') {
  const metadata: Omit<ArtifactManifest, 'artifactDigest'> = {
    schemaVersion: 1,
    compilerVersion: '0.1.0',
    inputDigest: '0'.repeat(64),
    files: { 'index.html': '1'.repeat(64) },
    routes: ['/'],
    diagnostics: [],
    plugins: [{ name: 'test', version: value }],
  };
  const id = artifactIdentity(metadata);
  await mkdir(join(root, id));
  await writeFile(
    join(root, id, 'manifest.json'),
    JSON.stringify({ ...metadata, artifactDigest: id }),
  );
  return id;
}
describe('immutable publication metadata cache', () => {
  it('coalesces concurrent loads, retains immutable metadata and enforces file allowlists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-cache-'));
    const id = await artifact(root);
    const cache = new PublicationManifestCache(root);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => cache.get(id)),
    );
    expect(results.every((value) => value === results[0])).toBe(true);
    expect(results[0]!.hasFile('index.html')).toBe(true);
    expect(results[0]!.hasFile('../secret')).toBe(false);
    await rm(join(root, id, 'manifest.json'));
    expect(await cache.get(id)).toBe(results[0]);
    expect(cache.stats()).toMatchObject({ entries: 1, pending: 0 });
  });
  it('evicts old entries and does not cache a manifest with a forged identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-cache-'));
    const first = await artifact(root),
      second = await artifact(root, 'two');
    const cache = new PublicationManifestCache(root, 1024 * 1024, 1);
    await cache.get(first);
    await cache.get(second);
    expect(cache.stats().entries).toBe(1);
    await rm(join(root, first, 'manifest.json'));
    await expect(cache.get(first)).rejects.toThrow();
    const forged = 'f'.repeat(64);
    await rename(join(root, second), join(root, forged));
    await expect(cache.get(forged)).rejects.toThrow(/identity/);
    expect(cache.stats().pending).toBe(0);
  });
});
