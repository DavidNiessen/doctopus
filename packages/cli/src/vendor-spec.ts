import {
  lstat,
  mkdir,
  realpath,
  open,
  mkdtemp,
  link,
  readdir,
  rm,
} from 'node:fs/promises';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import {
  downloadReferenceSnapshot,
  loadReferenceSnapshot,
  readBoundedFile,
  parseReferencePolicy,
} from '@davidniessen/doctopus-spec';
import type {
  ReferencePolicy,
  ReferenceSnapshotOptions,
} from '@davidniessen/doctopus-spec';
import { digest } from '@davidniessen/doctopus-compiler';
export interface VendorSpecOptions extends ReferenceSnapshotOptions {
  output?: string;
}
async function checkedDirectory(root: string, path: string) {
  let current = root;
  for (const segment of path.split('/')) {
    current = join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(
        'Snapshot output directories must not be symlinks or special files',
      );
  }
  if ((await realpath(current)) !== current)
    throw new Error('Snapshot output directory changed');
  return current;
}
/** Create or resume an immutable cache; the manifest is linked last as its commit marker. */
export async function vendorRemoteSpec(
  project: string,
  policy: ReferencePolicy,
  options: VendorSpecOptions,
) {
  const root = await realpath(resolve(project)),
    output = options.output ?? 'spec-snapshots';
  if (
    output.length > 800 ||
    !output
      .split('/')
      .every((segment) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment)) ||
    isAbsolute(output)
  )
    throw new Error('Use a canonical project-relative snapshot directory');
  const parent = await checkedDirectory(root, output);
  const snapshot = await downloadReferenceSnapshot(
    parseReferencePolicy(policy),
    options,
  );
  const target = join(parent, snapshot.manifest.digest),
    local = relative(root, target).split(sep).join('/');
  const lockPath = join(
    parent,
    `.doctopus-vendor-${snapshot.manifest.digest}.lock`,
  );
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new Error(
      'This snapshot is being written; inspect a stale vendor lock after a crashed process',
    );
  });
  let stage: string | undefined;
  try {
    try {
      await mkdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const directory = await lstat(target);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error('Snapshot destination must be a real directory');
    const expected = new Map(
      snapshot.sources.map((source) => [source.path, source.source]),
    );
    const names = await readdir(target);
    if (names.some((name) => name !== 'snapshot.json' && !expected.has(name)))
      throw new Error(
        'Snapshot contains unexpected local files; they were preserved',
      );
    if (names.includes('snapshot.json')) {
      const existing = await loadReferenceSnapshot(
        root,
        local + '/snapshot.json',
      );
      if (existing.manifest.digest !== snapshot.manifest.digest)
        throw new Error('Existing snapshot integrity failed');
    } else {
      stage = await mkdtemp(join(parent, '.doctopus-vendor-stage-'));
      const staged = [
        ...snapshot.sources,
        {
          path: 'snapshot.json',
          source: Buffer.from(
            JSON.stringify(snapshot.manifest, null, 2) + '\n',
          ),
        },
      ];
      for (const source of staged) {
        const file = await open(join(stage, source.path), 'wx', 0o600);
        try {
          await file.writeFile(source.source);
          await file.sync();
        } finally {
          await file.close();
        }
      }
      // Never replace existing files, including concurrent edits. A partial matching cache is resumable.
      for (const source of staged) {
        const destination = join(target, source.path);
        try {
          await link(join(stage, source.path), destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const info = await lstat(destination);
          if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            digest(
              await readBoundedFile(
                destination,
                Math.max(1, source.source.length),
              ),
            ) !== digest(source.source)
          )
            throw new Error(
              'Snapshot local files differ from approved bytes; they were preserved',
              { cause: error },
            );
        }
      }
      await loadReferenceSnapshot(root, local + '/snapshot.json');
    }
    return {
      path: local + '/' + snapshot.manifest.documents[0]!.path,
      references: local + '/snapshot.json',
      digest: snapshot.manifest.digest,
      sources: snapshot.sources.length,
      bytes: snapshot.sources.reduce(
        (sum, source) => sum + source.source.length,
        0,
      ),
    };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
