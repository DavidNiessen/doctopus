import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  symlink,
  rm,
  copyFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../recovery.mjs', import.meta.url));
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: 'doctopus-override-test',
};
const run = (target, args, env = environment, script = cli) =>
  spawnSync(
    process.execPath,
    [script, 'backup', target, '--writers-paused', ...args],
    { env, encoding: 'utf8', timeout: 5000 },
  );

test('recovery rejects malformed override arguments before creating a backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-recovery-options-'));
  const target = join(root, 'backup');
  try {
    for (const args of [
      ['--compose-override'],
      ['--unknown', 'file'],
      ['--compose-override', 'file', 'extra'],
    ]) {
      const result = run(target, args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Usage:.*--compose-override/);
      await assert.rejects(lstat(target), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recovery refuses linked, directory and oversized override files without backup or Docker side effects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-recovery-files-'));
  const target = join(root, 'backup');
  try {
    await writeFile(join(root, 'valid.json'), '{}');
    await symlink(join(root, 'valid.json'), join(root, 'linked.json'));
    await mkdir(join(root, 'directory'));
    await writeFile(join(root, 'large.json'), Buffer.alloc(1024 * 1024 + 1));
    for (const path of ['linked.json', 'directory', 'large.json']) {
      const result = run(target, ['--compose-override', join(root, path)]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /regular file no larger than 1 MiB/);
      await assert.rejects(lstat(target), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('copied offline operators run without npm dependencies and forward their Compose override before retaining a failed backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-recovery-forward-'));
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'deploy'));
    for (const file of ['recovery.mjs', 'init-deployment.mjs'])
      await copyFile(
        new URL('../' + file, import.meta.url),
        join(root, 'scripts', file),
      );
    for (const file of [
      'compose.yaml',
      'compose.restore.yaml',
      'init-database.sh',
    ])
      await copyFile(
        new URL('../../deploy/' + file, import.meta.url),
        join(root, 'deploy', file),
      );
    const initialized = spawnSync(
      process.execPath,
      [join(root, 'scripts/init-deployment.mjs')],
      { cwd: root, env: environment, encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.equal(
      (await lstat(join(root, 'deploy/.secrets'))).mode & 0o777,
      0o700,
    );
    const bin = join(root, 'bin');
    await mkdir(bin);
    const record = join(root, 'command.json');
    await writeFile(
      join(bin, 'docker'),
      `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\nprocess.stderr.write('fixture Docker stopped before execution');\nprocess.exit(23);\n`,
      { mode: 0o755 },
    );
    const override = join(root, 'offline.json');
    await writeFile(override, '{}');
    const target = join(root, 'backup');
    const result = run(
      target,
      ['--compose-override', override],
      {
        ...environment,
        PATH: bin + delimiter + environment.PATH,
      },
      join(root, 'scripts/recovery.mjs'),
    );
    assert.equal(result.status, 1);
    const args = JSON.parse(await readFile(record, 'utf8'));
    assert.equal(args[0], 'compose');
    assert(args.includes(join(root, 'deploy/compose.yaml')));
    const selected = args.indexOf(override);
    assert(selected > 0 && args[selected - 1] === '-f');
    assert(selected < args.indexOf('exec'));
    assert((await lstat(join(target, '.incomplete'))).isFile());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
