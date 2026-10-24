import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRegularFile } from '../lib/read-regular-file.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-regular-read-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('regular reads retain exact bytes at the limit and reject excessive files and limits', async (t) => {
  const path = join(await fixture(t), 'input');
  const bytes = Buffer.alloc(65537, 0x61);
  await writeFile(path, bytes);
  assert.deepEqual(await readRegularFile(path, bytes.length), bytes);
  await assert.rejects(readRegularFile(path, bytes.length - 1));
  for (const maximum of [0, -1, 0.5, NaN, Infinity, 64 * 1024 * 1024 + 1])
    await assert.rejects(readRegularFile(path, maximum));
  await writeFile(path, '');
  assert.equal((await readRegularFile(path, 1)).length, 0);
});

test('regular reads refuse links and special files without waiting for a writer', async (t) => {
  const root = await fixture(t),
    file = join(root, 'file'),
    linked = join(root, 'link');
  await writeFile(file, 'private');
  await symlink(file, linked);
  await assert.rejects(readRegularFile(linked));
  await assert.rejects(readRegularFile(root));
  const fifo = join(root, 'fifo');
  execFileSync('mkfifo', [fifo]);
  await assert.rejects(readRegularFile(fifo));
});
