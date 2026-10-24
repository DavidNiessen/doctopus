import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ArtifactManifest } from '@davidniessen/doctopus-contracts';
import {
  artifactIdentity,
  parseArtifactManifest,
} from '@davidniessen/doctopus-compiler';

const vector = JSON.parse(
  await readFile(
    'integrations/java/core/src/test/resources/manifest-v2-vector.json',
    'utf8',
  ),
) as {
  manifest: ArtifactManifest;
  canonical: string;
  artifactDigest: string;
  manifestJson: string;
};
describe('portable manifest version 2', () => {
  it('matches the fixed Java/Node canonical vector including numeric keys and Unicode', () => {
    expect(vector.artifactDigest).toBe(
      '42b177c8c4cdf584243ee49a25d21a40c10337d1b115ff0e5c2d688c0efd5edc',
    );
    expect(createHash('sha256').update(vector.canonical).digest('hex')).toBe(
      vector.artifactDigest,
    );
    expect(artifactIdentity(vector.manifest)).toBe(vector.artifactDigest);
    expect(parseArtifactManifest(JSON.parse(vector.manifestJson))).toEqual(
      vector.manifest,
    );
  });
  it('ignores dictionary insertion order at every metadata level', () => {
    const shuffle = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(shuffle)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, child]) => [key, shuffle(child)]),
            )
          : value;
    const reordered = shuffle(vector.manifest) as ArtifactManifest;
    expect(artifactIdentity(reordered)).toBe(vector.artifactDigest);
    expect(parseArtifactManifest(reordered)).toEqual(vector.manifest);
  });
  it.each([
    {
      diagnostics: [
        {
          code: 'test',
          severity: 'warning',
          message: 'Message',
          ignored: true,
        },
      ],
    },
    { plugins: [{ name: 'test', version: '1.0.0', ignored: true }] },
    {
      plugins: [
        {
          name: 'test',
          version: '1.0.0',
          inputs: [{ path: 'file', digest: 'a'.repeat(64), ignored: true }],
        },
      ],
    },
    { routes: Array<string>(1) },
    { plugins: Array<unknown>(1) },
  ])('rejects untyped metadata even with a recomputed identity %#', (patch) => {
    const manifest = { ...vector.manifest, ...patch } as ArtifactManifest;
    manifest.artifactDigest = artifactIdentity(manifest);
    expect(() => parseArtifactManifest(manifest)).toThrow(/metadata/);
  });
  it('retains Node verification of legacy manifests without silently changing their digest', () => {
    const legacy = { ...vector.manifest, schemaVersion: 1 as const };
    legacy.artifactDigest = artifactIdentity(legacy);
    expect(parseArtifactManifest(legacy)).toEqual(legacy);
    expect(legacy.artifactDigest).not.toBe(vector.artifactDigest);
  });
});
