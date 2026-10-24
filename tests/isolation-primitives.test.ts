import { afterEach, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  link,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { Header, Pax } from 'tar';
import type { HeaderData } from 'tar';
import { extractIsolatedArchive } from '../packages/cli/src/isolation-archive.js';
import { snapshotProject } from '../packages/cli/src/isolation-snapshot.js';
import { buildIsolatedSite } from '../packages/cli/src/isolation.js';

const directories: string[] = [];
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'doctopus-isolation-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
function entry(path: string, body = Buffer.alloc(0), extra: HeaderData = {}) {
  const header = Buffer.alloc(512);
  new Header({
    path,
    type: 'File',
    mode: 0o777,
    size: body.length,
    ...extra,
  }).encode(header);
  return Buffer.concat([
    header,
    body,
    Buffer.alloc((512 - (body.length % 512)) % 512),
  ]);
}
function archive(...entries: Buffer[]) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}
async function extract(data: Buffer, maxBytes = 1024) {
  const directory = await temporary();
  const files = await extractIsolatedArchive(
    Readable.from([data]),
    directory,
    maxBytes,
  );
  return { directory, files };
}

it('exports nested regular files, empty files and binary bytes without applying archive permissions', async () => {
  const bytes = Buffer.from([0, 255, 1, 2]);
  const result = await extract(
    archive(
      entry('./', undefined, { type: 'Directory' }),
      entry('./assets/', undefined, { type: 'Directory' }),
      entry('./assets/data.bin', bytes),
      entry('./empty'),
    ),
  );
  expect(result.files.sort()).toEqual(['assets/data.bin', 'empty']);
  expect(await readFile(join(result.directory, 'assets/data.bin'))).toEqual(
    bytes,
  );
  expect(await readFile(join(result.directory, 'empty'))).toHaveLength(0);
});

it.each([
  '../escape',
  '/absolute',
  'C:/drive',
  'a\\b',
  'a/../b',
  'a//b',
  'a/./b',
])('rejects unsafe archive path %s', async (path) => {
  await expect(extract(archive(entry(path)))).rejects.toThrow();
});
it.each([
  'Link',
  'SymbolicLink',
  'FIFO',
  'CharacterDevice',
  'BlockDevice',
  'SparseFile',
] as const)('rejects archive type %s', async (type) => {
  await expect(
    extract(
      archive(
        entry('bad', undefined, {
          type,
          ...(type.includes('Link') ? { linkpath: 'target' } : {}),
        }),
      ),
    ),
  ).rejects.toThrow();
});
it('rejects duplicate normalized paths, PAX traversal, compressed and incomplete archives', async () => {
  for (const data of [
    archive(entry('same'), entry('./same')),
    archive(new Pax({ path: '../escape' }).encode(), entry('safe')),
    gzipSync(archive(entry('file'))),
    entry('missing-eof'),
    Buffer.alloc(7),
    archive(entry('file', Buffer.from('oversized'))),
  ]) {
    await expect(extract(data, 3)).rejects.toThrow();
  }
});
it('honors cancellation before reading an archive', async () => {
  const signal = AbortSignal.abort();
  await expect(
    extractIsolatedArchive(
      Readable.from([archive(entry('file'))]),
      await temporary(),
      1024,
      signal,
    ),
  ).rejects.toThrow();
});
it('accepts bounded PAX paths and streams file bytes with backpressure', async () => {
  const directory = await temporary();
  const path = 'nested/' + 'long-'.repeat(35) + '.bin';
  const body = Buffer.alloc(256 * 1024, 0xa5);
  const data = archive(new Pax({ path }).encode(), entry('short', body));
  const chunks = async function* () {
    for (let offset = 0; offset < data.length; offset += 997)
      yield data.subarray(offset, offset + 997);
  };
  expect(
    await extractIsolatedArchive(
      Readable.from(chunks()),
      directory,
      body.length,
    ),
  ).toEqual([path]);
  expect(await readFile(join(directory, path))).toEqual(body);
});
it('rejects oversized metadata and a truncated file body', async () => {
  await expect(
    extract(
      archive(new Pax({ path: 'a'.repeat(70 * 1024) }).encode(), entry('file')),
    ),
  ).rejects.toThrow();
  const header = Buffer.alloc(512);
  new Header({ path: 'truncated', type: 'File', size: 1000 }).encode(header);
  await expect(
    extract(Buffer.concat([header, Buffer.alloc(8)])),
  ).rejects.toThrow();
});
it('serializes filesystem creation for an archive containing many empty files', async () => {
  const result = await extract(
    archive(...Array.from({ length: 1000 }, (_, i) => entry(`empty/${i}`))),
  );
  expect(result.files).toHaveLength(1000);
});
it('snapshots only visible single-link source files and produces a deterministic digest', async () => {
  const source = await temporary();
  await mkdir(join(source, 'nested'));
  await mkdir(join(source, 'node_modules'));
  await writeFile(join(source, 'nested', 'file'), 'data');
  await writeFile(join(source, '.env'), 'secret');
  await writeFile(join(source, 'node_modules', 'ignored'), 'dependency');
  const first = await snapshotProject(
    source,
    join(await temporary(), 'source'),
    4,
  );
  expect(first).toMatchObject({ files: 1, bytes: 4 });
  expect(
    await snapshotProject(source, join(await temporary(), 'source'), 4),
  ).toEqual(first);
  await expect(
    snapshotProject(source, join(await temporary(), 'source'), 3),
  ).rejects.toThrow();
});
it.each(['symlink', 'hardlink'])('rejects source %s entries', async (kind) => {
  const source = await temporary();
  await writeFile(join(source, 'file'), 'data');
  if (kind === 'symlink') await symlink('file', join(source, 'other'));
  else await link(join(source, 'file'), join(source, 'other'));
  await expect(
    snapshotProject(source, join(await temporary(), 'source'), 100),
  ).rejects.toThrow();
});
it('rejects already-cancelled snapshots, including empty sources', async () => {
  await expect(
    snapshotProject(
      await temporary(),
      join(await temporary(), 'snapshot'),
      100,
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
});
it('rejects mutable images and invalid limits before touching a publication', async () => {
  await expect(
    buildIsolatedSite('/missing', { image: 'worker:latest' }),
  ).rejects.toThrow('immutable');
  const image = 'sha256:' + 'a'.repeat(64);
  for (const limits of [
    { timeoutMs: 0 },
    { cpus: 1.5 },
    { memoryMiB: 1 },
    { pids: 0 },
    { sourceMiB: NaN },
    { outputMiB: 4096 },
  ])
    await expect(
      buildIsolatedSite('/missing', { image, ...limits }),
    ).rejects.toThrow('limits');
  await expect(
    buildIsolatedSite('/missing', { image, config: '../outside' }),
  ).rejects.toThrow('project-relative');
});
