import { describe, expect, it } from 'vitest';
import {
  mkdtemp,
  cp,
  readFile,
  writeFile,
  symlink,
  access,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { renderMarkdown } from '@davidniessen/doctopus-content';
import {
  verifyArtifact,
  writeManifest,
  safeOutput,
} from '@davidniessen/doctopus-compiler';
import { buildSite, createStaticServer } from '@davidniessen/doctopus-cli';
describe('static publishing', () => {
  it('sanitizes active content and creates stable heading links', async () => {
    const output = await renderMarkdown(
      '## Safe heading\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))',
    );
    expect(output.html).not.toContain('<script');
    expect(output.html).not.toContain('href="javascript:');
    expect(output.headings[0]?.id).toBe('heading-safe-heading');
  });
  it('builds deterministic verified output and serves real routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-build-'));
    await cp(resolve('examples/demo'), root, {
      recursive: true,
      filter: (path) =>
        !path.includes('.doctopus') && !path.includes('.api-docs'),
    });
    const first = await buildSite(root);
    const manifest1 = await verifyArtifact(first.directory);
    await buildSite(root);
    const manifest2 = await verifyArtifact(first.directory);
    expect(manifest2.files).toEqual(manifest1.files);
    expect(manifest2.artifactDigest).toBe(manifest1.artifactDigest);
    const server = await createStaticServer(first.directory);
    try {
      const page = await server.inject('/api/orbit/v1/create-project/');
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('Create a project');
      expect(page.headers['content-security-policy']).toContain(
        "script-src 'self'",
      );
      expect((await server.inject('/missing/')).statusCode).toBe(404);
    } finally {
      await server.close();
    }
    const assetPath = join(first.directory, 'assets/reader.js');
    await writeFile(
      assetPath,
      (await readFile(assetPath, 'utf8')) + '\n/* Renderer upgrade fixture */',
    );
    const upgraded = await writeManifest(
      first.directory,
      first.site,
      manifest1.routes,
    );
    expect(upgraded.inputDigest).toBe(manifest1.inputDigest);
    expect(upgraded.artifactDigest).not.toBe(manifest1.artifactDigest);
    await verifyArtifact(first.directory);
    const path = join(first.directory, 'index.html');
    await writeFile(path, (await readFile(path, 'utf8')) + 'tampered');
    await expect(verifyArtifact(first.directory)).rejects.toThrow(/checksum/);
  });
  it('does not write outside protected build output', async () => {
    await expect(
      buildSite(resolve('examples/demo'), { output: 'guides' }),
    ).rejects.toThrow(/output/);
  });
  it('rejects output symlinks before creating directories outside the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-symlink-'));
    const outside = await mkdtemp(join(tmpdir(), 'doctopus-outside-'));
    await symlink(outside, join(root, '.doctopus'));
    await expect(safeOutput(root, '.doctopus/site')).rejects.toThrow(
      /symlinks/,
    );
    await expect(access(join(outside, 'site'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
