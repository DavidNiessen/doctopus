import { describe, it, expect } from 'vitest';
import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  stat,
  rename,
  symlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDevelopmentBuilder,
  buildSite,
  stageArtifact,
} from '@davidniessen/doctopus-cli';
import { verifyArtifact } from '@davidniessen/doctopus-compiler';
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-incremental-'));
  await cp(resolve('examples/demo'), root, {
    recursive: true,
    filter: (path) =>
      !path.includes('.doctopus') && !path.includes('.api-docs'),
  });
  return root;
}
describe('incremental development builds', () => {
  it('changes only affected guide outputs and matches a clean full build byte for byte', async () => {
    const root = await project();
    const builder = createDevelopmentBuilder(root);
    const first = await builder.build();
    expect(first.mode).toBe('full');
    const apiPage = join(
      first.directory,
      'api/orbit/v1/create-project/index.html',
    );
    const before = await stat(apiPage);
    const guide = join(root, 'guides/introduction.md');
    await writeFile(
      guide,
      (await readFile(guide, 'utf8')) +
        '\n\n## Updated section\n\nNew incremental body text.\n\n[Authentication](authentication.md)\n',
    );
    const changed = await builder.build(['guides/introduction.md']);
    expect(changed.mode).toBe('incremental');
    expect((await stat(apiPage)).mtimeMs).toBe(before.mtimeMs);
    expect(
      await readFile(join(first.directory, 'index.html'), 'utf8'),
    ).toContain('New incremental body text.');
    await verifyArtifact(changed.directory);
    const target = await mkdtemp(join(tmpdir(), 'doctopus-incremental-store-'));
    expect(await stageArtifact(changed.directory, target)).toBe(
      changed.manifest.artifactDigest,
    );
    const full = await buildSite(root);
    expect(full.manifest.files).toEqual(changed.manifest.files);
    expect(full.manifest.artifactDigest).toBe(changed.manifest.artifactDigest);
  });
  it('rebuilds fully when navigation or schema dependencies change and preserves the last result on parse errors', async () => {
    const root = await project();
    const builder = createDevelopmentBuilder(root);
    const first = await builder.build();
    const guide = join(root, 'guides/introduction.md'),
      original = await readFile(guide, 'utf8');
    await writeFile(guide, '---\ntitle: null\n---\n# Invalid');
    await expect(builder.build(['guides/introduction.md'])).rejects.toThrow(
      /frontmatter/,
    );
    expect((await verifyArtifact(first.directory)).artifactDigest).toBe(
      first.manifest.artifactDigest,
    );
    await writeFile(
      guide,
      original.replace('title: Introduction', 'title: Welcome'),
    );
    expect((await builder.build(['guides/introduction.md'])).mode).toBe('full');
    expect((await builder.build(['openapi.json'])).mode).toBe('full');
  });
  it('discards cached state after a separate build replaces the output', async () => {
    const root = await project();
    const builder = createDevelopmentBuilder(root);
    await builder.build();
    const config = join(root, 'docs.config.yaml');
    await writeFile(
      config,
      (await readFile(config, 'utf8')).replace(
        'name: Orbit',
        'name: Renamed docs',
      ),
    );
    await buildSite(root);
    const guide = join(root, 'guides/introduction.md');
    await writeFile(guide, (await readFile(guide, 'utf8')) + '\n\nNew body.\n');
    const next = await builder.build(['guides/introduction.md']);
    expect(next.mode).toBe('full');
    expect(next.site.config.name).toBe('Renamed docs');
  });
  it('rejects output directory symlinks before an incremental update writes outside the project', async () => {
    const root = await project(),
      outside = await mkdtemp(join(tmpdir(), 'doctopus-incremental-outside-'));
    const builder = createDevelopmentBuilder(root);
    const first = await builder.build();
    const path = join(first.directory, 'guides');
    await rename(path, join(first.directory, 'old-guides'));
    await symlink(outside, path);
    const guide = join(root, 'guides/introduction.md');
    await writeFile(
      guide,
      (await readFile(guide, 'utf8')) + '\n\nUpdated body.\n',
    );
    await expect(builder.build(['guides/introduction.md'])).rejects.toThrow(
      /symlinks/,
    );
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(outside)).toEqual([]);
  });
});
