import { afterEach, describe, expect, it } from 'vitest';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDevelopmentBuilder,
  createStaticServer,
} from '@davidniessen/doctopus-cli';
import type { StaticDocsServer } from '@davidniessen/doctopus-cli';
import { artifactIdentity } from '@davidniessen/doctopus-compiler';
import type { ArtifactManifest } from '@davidniessen/doctopus-contracts';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const owned: { root: string; server?: StaticDocsServer }[] = [];
afterEach(async () => {
  for (const item of owned.splice(0)) {
    await item.server?.close();
    await rm(item.root, { recursive: true, force: true });
  }
});
async function fixture(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-static-'));
  const cleanup: (typeof owned)[number] = { root };
  owned.push(cleanup);
  await cp(resolve('examples/demo'), root, {
    recursive: true,
    filter: (path) =>
      !path.includes('.doctopus') && !path.includes('.api-docs'),
  });
  const config = join(root, 'docs.config.yaml');
  await writeFile(
    config,
    (await readFile(config, 'utf8')) +
      '\nbasePath: ' +
      JSON.stringify(prefix) +
      '\n',
  );
  const builder = createDevelopmentBuilder(root);
  const built = await builder.build();
  return { root, config, builder, built, cleanup };
}
describe.each(['', '/manual'])('verified CLI serving at %j', (prefix) => {
  it('serves listed files and page aliases while denying extra files, metadata and symlinks', async () => {
    const { root, built, cleanup } = await fixture(prefix);
    await mkdir(join(built.directory, 'extra'));
    for (const file of [
      'private.txt',
      'assets/private.txt',
      'extra/index.html',
    ])
      await writeFile(join(built.directory, file), 'private-static-fixture');
    await writeFile(join(root, 'outside.txt'), 'outside-static-fixture');
    await symlink(
      join(root, 'outside.txt'),
      join(built.directory, 'outside-link.txt'),
    );
    await expect(createStaticServer(built.directory, '/wrong')).rejects.toThrow(
      /mount path/,
    );
    const server = (cleanup.server = await createStaticServer(built.directory));
    for (const path of [
      '/',
      '/assets/reader.js',
      '/search.json',
      '/oauth/callback/',
      '/guides/quickstart/',
    ]) {
      const response = await server.inject(prefix + path);
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
    for (const path of [
      '/private.txt',
      '/assets/private.txt',
      '/extra/',
      '/extra/index.html',
      '/outside-link.txt',
      '/manifest.json',
    ]) {
      for (const method of ['GET', 'HEAD'] as const) {
        const response = await server.inject({
          url: prefix + path,
          method,
          headers: { range: 'bytes=0-50' },
        });
        expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain('private-static-fixture');
        expect(response.body).not.toContain('outside-static-fixture');
      }
    }
    expect(
      (await server.inject(prefix + '/assets/%72eader.js?v=1')).statusCode,
    ).toBe(200);
    const redirect = await server.inject(
      prefix + '/guides/quickstart?from=fixture',
    );
    expect(redirect.statusCode).toBe(301);
    expect(redirect.headers.location).toBe(
      prefix + '/guides/quickstart/?from=fixture',
    );
    for (const path of [
      '/assets//private.txt',
      '/private%2etxt',
      '/assets%2f..%2fprivate.txt',
      '/assets/%5cprivate.txt',
    ]) {
      const response = await server.inject(prefix + path);
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
      expect(response.body).not.toContain('private-static-fixture');
    }
  });
  it('reloads verified route changes, fails closed on corruption and recovers after repair', async () => {
    const { root, config, builder, built, cleanup } = await fixture(prefix);
    const server = (cleanup.server = await createStaticServer(built.directory));
    const guide = join(root, 'guides/new.md');
    await writeFile(
      guide,
      '---\ntitle: New guide\n---\n\n## Fresh content\n\nA newly compiled page.\n',
    );
    expect((await builder.build([guide])).mode).toBe('full');
    expect((await server.inject(prefix + '/guides/new/')).statusCode).toBe(404);
    await server.reloadPublication();
    expect((await server.inject(prefix + '/guides/new/')).body).toContain(
      'Fresh content',
    );
    // Guide-body-only edits keep membership unchanged and need no full reload.
    await writeFile(
      guide,
      (await readFile(guide, 'utf8')).replace(
        'Fresh content',
        'Incremental content',
      ),
    );
    expect((await builder.build([guide])).mode).toBe('incremental');
    expect((await server.inject(prefix + '/guides/new/')).body).toContain(
      'Incremental content',
    );
    const asset = join(built.directory, 'assets/reader.js');
    const original = await readFile(asset);
    await writeFile(
      asset,
      Buffer.concat([original, Buffer.from('\ncorrupted-fixture')]),
    );
    await expect(server.reloadPublication()).rejects.toThrow(/checksum/);
    for (const path of [
      '/health/ready',
      prefix + '/',
      prefix + '/assets/reader.js',
    ])
      expect((await server.inject(path)).statusCode).toBe(503);
    expect((await server.inject('/health/live')).statusCode).toBe(200);
    await writeFile(asset, original);
    await server.reloadPublication();
    expect((await server.inject('/health/ready')).statusCode).toBe(200);
    expect((await server.inject(prefix + '/assets/reader.js')).statusCode).toBe(
      200,
    );
    const originalConfig = await readFile(config, 'utf8');
    await writeFile(
      config,
      originalConfig.replace(
        'basePath: ' + JSON.stringify(prefix),
        'basePath: /changed',
      ),
    );
    expect((await builder.build([config])).mode).toBe('full');
    await expect(server.reloadPublication()).rejects.toThrow(
      /basePath changed/,
    );
    expect((await server.inject('/health/ready')).statusCode).toBe(503);
    await writeFile(config, originalConfig);
    await builder.build([config]);
    await server.reloadPublication();
    expect((await server.inject(prefix + '/guides/new/')).statusCode).toBe(200);
  });
  it('does not serve an unlisted custom error page and rejects corrupt startup artifacts', async () => {
    const { built, cleanup } = await fixture(prefix);
    const filename = join(built.directory, 'manifest.json');
    const manifest = JSON.parse(
      await readFile(filename, 'utf8'),
    ) as ArtifactManifest;
    delete manifest.files['404.html'];
    manifest.artifactDigest = artifactIdentity(manifest);
    await writeFile(filename, JSON.stringify(manifest));
    await writeFile(join(built.directory, '404.html'), 'private-error-fixture');
    const server = (cleanup.server = await createStaticServer(built.directory));
    const response = await server.inject(prefix + '/missing/');
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('Not found');
    await writeFile(
      join(built.directory, 'index.html'),
      'corrupted-page-fixture',
    );
    await expect(createStaticServer(built.directory)).rejects.toThrow(
      /checksum/,
    );
  });
});

it('the real development CLI reloads added routes and serves incremental guide edits', async () => {
  const { root, built } = await fixture('/preview');
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, '127.0.0.1', resolve),
  );
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const child = spawn(
    process.execPath,
    [resolve('packages/cli/dist/main.js'), 'dev', root, '--port', String(port)],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  const exited = new Promise<void>((resolve) =>
    child.once('close', () => resolve()),
  );
  let spawnError = false;
  child.once('error', () => {
    spawnError = true;
  });
  const base = `http://127.0.0.1:${port}`;
  async function waitFor(path: string, text: string) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null)
        throw new Error('Development CLI exited before readiness');
      try {
        const response = await fetch(base + path, {
          signal: AbortSignal.timeout(1000),
        });
        const content = await response.text();
        if (response.status === 200 && content.includes(text)) return;
      } catch {
        /* The owned child is still starting or rebuilding. */
      }
      await delay(50);
    }
    throw new Error(
      'Development CLI did not serve the expected verified publication',
    );
  }
  try {
    await waitFor('/health/ready', 'ready');
    const guide = join(root, 'guides/watched.md');
    await writeFile(
      guide,
      '---\ntitle: Watched guide\n---\n\nWatcher first content.\n',
    );
    await waitFor('/preview/guides/watched/', 'Watcher first content.');
    await writeFile(
      guide,
      '---\ntitle: Watched guide\n---\n\nWatcher second content.\n',
    );
    await waitFor('/preview/guides/watched/', 'Watcher second content.');
    await writeFile(
      join(built.directory, 'private.txt'),
      'private-watcher-fixture',
    );
    const rejected = await fetch(base + '/preview/private.txt');
    expect(rejected.status).toBe(404);
    expect(await rejected.text()).not.toContain('private-watcher-fixture');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([exited, delay(2000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await exited;
  }
}, 25_000);
