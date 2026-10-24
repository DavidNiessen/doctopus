import { afterEach, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  access,
  chmod,
  symlink,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  inspectIsolatedSource,
  buildIsolatedSite,
} from '@davidniessen/doctopus-cli';
import { readTextFile } from '@davidniessen/doctopus-spec';
const exec = promisify(execFile);
const roots: string[] = [];
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-source-pin-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it('inspects deterministic visible data without parsing configuration, running code or changing project output', async () => {
  const root = await temporary();
  const marker = join(root, 'executed');
  const project = join(root, 'project');
  await mkdir(project);
  await mkdir(join(project, 'node_modules'));
  await mkdir(join(project, 'nested'));
  await writeFile(
    join(project, 'docs.config.yaml'),
    'This is intentionally not a valid project config.',
  );
  await writeFile(
    join(project, 'plugin.mjs'),
    `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'ran');`,
  );
  await writeFile(join(project, 'nested', 'data.txt'), 'visible');
  await writeFile(join(project, '.env'), 'excluded fixture');
  await writeFile(join(project, 'node_modules', 'package.json'), '{}');
  const before = await readdir(project);
  const initial = await inspectIsolatedSource(project);
  expect(initial.digestVersion).toBe(2);
  expect(initial.files).toBe(3);
  expect(initial.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(initial.bytes).toBeGreaterThan(10);
  expect(await readdir(project)).toEqual(before);
  await expect(access(marker)).rejects.toThrow();
  await writeFile(join(project, '.env'), 'different hidden fixture');
  await writeFile(
    join(project, 'node_modules', 'package.json'),
    '{"scripts":{"install":"not executed"}}',
  );
  expect(await inspectIsolatedSource(project)).toEqual(initial);
  await mkdir(join(project, 'empty-directory'));
  expect((await inspectIsolatedSource(project)).digest).not.toBe(
    initial.digest,
  );
  await rm(join(project, 'empty-directory'), { recursive: true });
  expect(await inspectIsolatedSource(project)).toEqual(initial);
  await writeFile(join(project, 'nested', 'data.txt'), 'visible change');
  expect((await inspectIsolatedSource(project)).digest).not.toBe(
    initial.digest,
  );
});
it('enforces source inspection budgets, cancellation and link refusal through the public API', async () => {
  await expect(
    inspectIsolatedSource('/not-a-project', { sourceMiB: 0 }),
  ).rejects.toThrow('limits');
  await expect(
    inspectIsolatedSource('/not-a-project', { signal: AbortSignal.abort() }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  const root = await temporary();
  await writeFile(join(root, 'large'), Buffer.alloc(1024 * 1024 + 1));
  await expect(inspectIsolatedSource(root, { sourceMiB: 1 })).rejects.toThrow();
  await rm(join(root, 'large'));
  await writeFile(join(root, 'regular'), 'data');
  await symlink('regular', join(root, 'linked'));
  await expect(inspectIsolatedSource(root)).rejects.toThrow('symlinks');
});
it('rejects malformed digest approvals before reading source or touching Docker', async () => {
  for (const value of [
    '',
    'A'.repeat(64),
    'a'.repeat(63),
    'sha256:' + 'a'.repeat(64),
    false,
    123,
  ]) {
    await expect(
      buildIsolatedSite('/not-a-project', {
        image: 'sha256:' + 'a'.repeat(64),
        expectedSourceDigest: value as never,
      }),
    ).rejects.toThrow('lowercase SHA-256');
  }
});
it('the CLI returns source metadata without creating a publication or executing project files', async () => {
  const root = await temporary();
  await writeFile(
    join(root, 'docs.config.yaml'),
    'not parsed as configuration',
  );
  const result = await exec(
    process.execPath,
    ['packages/cli/dist/main.js', 'source-info', root, '--json'],
    { cwd: process.cwd(), timeout: 10000 },
  );
  const parsed = JSON.parse(result.stdout);
  expect(parsed).toEqual({
    schemaVersion: 1,
    source: await inspectIsolatedSource(root),
  });
  await expect(access(join(root, '.doctopus'))).rejects.toThrow();
  expect(result.stderr).toBe('');
});
it('a changed approved snapshot fails before any Docker command and retains an existing publication', async () => {
  const root = await temporary();
  const project = join(root, 'project'),
    bin = join(root, 'bin');
  await mkdir(project);
  await mkdir(bin);
  await mkdir(join(project, '.doctopus', 'site'), { recursive: true });
  await writeFile(
    join(project, 'docs.config.yaml'),
    'name: Approval fixture\nspecs: [{id:api,path:openapi.json}]\n',
  );
  await writeFile(join(project, 'openapi.json'), '{}');
  await writeFile(
    join(project, '.doctopus', 'site', 'sentinel'),
    'prior publication',
  );
  const approved = await inspectIsolatedSource(project);
  await writeFile(join(project, 'openapi.json'), '{"changed":true}');
  const marker = join(root, 'docker-call');
  const executable = join(bin, 'docker');
  // TMPDIR may live inside an ESM checkout; the fake executable uses CommonJS.
  await writeFile(join(bin, 'package.json'), '{"type":"commonjs"}\n');
  await writeFile(
    executable,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.DOCTOPUS_DOCKER_CALL, JSON.stringify(process.argv.slice(2)));process.exit(2);\n`,
  );
  await chmod(executable, 0o755);
  const socket = join(root, 'docker.sock');
  let connections = 0;
  const daemon = createServer((client) => {
    connections++;
    client.destroy();
  });
  daemon.listen(socket);
  await once(daemon, 'listening');
  const environment = {
    ...process.env,
    PATH: bin + delimiter + (process.env.PATH ?? ''),
    DOCTOPUS_DOCKER_CALL: marker,
  };
  const run = (digest: string) =>
    exec(
      process.execPath,
      [
        'packages/cli/dist/main.js',
        'isolated-build',
        project,
        '--image',
        'sha256:' + 'a'.repeat(64),
        '--socket',
        socket,
        '--source-digest',
        digest,
      ],
      { cwd: process.cwd(), env: environment, timeout: 10000 },
    );
  try {
    await expect(run(approved.digest)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('source digest verification'),
    });
    await expect(access(marker)).rejects.toThrow();
    expect(connections).toBe(0);
    expect(
      await readFile(join(project, '.doctopus', 'site', 'sentinel'), 'utf8'),
    ).toBe('prior publication');
    expect(await readdir(join(project, '.doctopus'))).toEqual(['site']);
    const current = await inspectIsolatedSource(project);
    await expect(run(current.digest)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('image verification'),
    });
    expect(JSON.parse(await readTextFile(marker))).toEqual([
      '--host=unix://' + socket,
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      'sha256:' + 'a'.repeat(64),
    ]);
    expect(
      await readFile(join(project, '.doctopus', 'site', 'sentinel'), 'utf8'),
    ).toBe('prior publication');
    expect(await readdir(join(project, '.doctopus'))).toEqual(['site']);
  } finally {
    await new Promise<void>((resolve, reject) =>
      daemon.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
