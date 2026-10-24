import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  parseArtifactManifest,
  artifactIdentity,
  verifyArtifact,
} from '@davidniessen/doctopus-compiler';
import { readBoundedFile } from '@davidniessen/doctopus-spec';
import type { ArtifactManifest } from '@davidniessen/doctopus-contracts';
function manifest(files: Record<string, string> = {}): ArtifactManifest {
  const metadata = {
    schemaVersion: 1 as const,
    compilerVersion: '0.1.0',
    inputDigest: '0'.repeat(64),
    files,
    routes: ['/'],
    diagnostics: [],
    plugins: [],
  };
  return { ...metadata, artifactDigest: artifactIdentity(metadata) };
}
const identify = (input: Record<string, unknown>) => ({
  ...input,
  artifactDigest: artifactIdentity(input as unknown as ArtifactManifest),
});
describe('artifact and source file boundaries', () => {
  it.each([
    '../outside',
    '/absolute',
    'a//b',
    'a\\b',
    '.env',
    'assets/.hidden/file',
  ])(
    'rejects noncanonical or hidden manifest paths even with a recomputed identity (%s)',
    (path) => {
      expect(() =>
        parseArtifactManifest(manifest({ [path]: '1'.repeat(64) })),
      ).toThrow(/metadata/);
    },
  );
  it('validates metadata types and identity before consumers use paths', () => {
    const valid = manifest({ 'assets/reader.js.map': '1'.repeat(64) });
    expect(parseArtifactManifest(valid)).toEqual(valid);
    for (const patch of [
      { files: [] },
      { routes: [42] },
      { plugins: {} },
      {
        diagnostics: [{ code: 'test', message: 'test', severity: 'critical' }],
      },
      { injected: 'uncovered metadata' },
    ])
      expect(() =>
        parseArtifactManifest(identify({ ...valid, ...patch })),
      ).toThrow(/metadata/);
    expect(() =>
      parseArtifactManifest({ ...valid, artifactDigest: 'f'.repeat(64) }),
    ).toThrow(/identity mismatch/);
  });
  it('checks all bytes of a large file and catches corruption at its end', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-large-artifact-'));
    try {
      const value = Buffer.alloc(8 * 1024 * 1024, 42),
        path = join(root, 'large.json');
      await writeFile(path, value);
      const expected = manifest({
        'large.json': createHash('sha256').update(value).digest('hex'),
      });
      await writeFile(join(root, 'manifest.json'), JSON.stringify(expected));
      expect((await verifyArtifact(root)).artifactDigest).toBe(
        expected.artifactDigest,
      );
      const file = await open(path, 'r+');
      try {
        await file.write(Buffer.from([43]), 0, 1, value.length - 1);
      } finally {
        await file.close();
      }
      await expect(verifyArtifact(root)).rejects.toThrow(/checksum/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.skipIf(process.platform === 'win32')(
    'rejects named pipes promptly in source and artifact payload reads',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'doctopus-pipe-boundary-'));
      try {
        const path = join(root, 'pipe.json');
        execFileSync('mkfifo', [path]);
        await expect(readBoundedFile(path)).rejects.toThrow(/regular file/);
        await writeFile(
          join(root, 'manifest.json'),
          JSON.stringify(manifest({ 'pipe.json': '1'.repeat(64) })),
        );
        await expect(verifyArtifact(root)).rejects.toThrow(/regular file/);
        await rm(join(root, 'manifest.json'));
        execFileSync('mkfifo', [join(root, 'manifest.json')]);
        await expect(verifyArtifact(root)).rejects.toThrow(/regular file/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it('bounds manifest reads before JSON parsing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-large-manifest-'));
    try {
      const file = await open(join(root, 'manifest.json'), 'w');
      try {
        await file.truncate(16 * 1024 * 1024 + 1);
      } finally {
        await file.close();
      }
      await expect(verifyArtifact(root)).rejects.toThrow(/exceeds/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
