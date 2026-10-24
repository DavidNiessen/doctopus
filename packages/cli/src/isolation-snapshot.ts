import { chmod, lstat, mkdir, opendir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readBoundedFile } from '@davidniessen/doctopus-spec';

/** Stage data only. No source/package scripts run on the operator host. */
export async function snapshotProject(
  root: string,
  target: string,
  maxBytes: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const files: { path: string; digest: string }[] = [];
  const directories: string[] = [];
  let bytes = 0,
    entries = 0;
  async function walk(source: string, destination: string, prefix = '') {
    await mkdir(destination, { recursive: true });
    await chmod(destination, 0o755);
    for await (const entry of await opendir(source)) {
      signal?.throwIfAborted();
      if (++entries > 30_000)
        throw new Error('Isolated source exceeds 30,000 filesystem entries');
      // Hidden entries include credential/configuration directories and build output.
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const input = join(source, entry.name),
        output = join(destination, entry.name);
      const path = prefix + entry.name;
      const info = await lstat(input);
      if (info.isSymbolicLink())
        throw new Error('Isolated source cannot contain symlinks');
      if (info.isDirectory()) {
        directories.push(path);
        await walk(input, output, path + '/');
      } else if (info.isFile() && info.nlink === 1) {
        const content = await readBoundedFile(
          input,
          Math.min(64 * 1024 * 1024, maxBytes - bytes),
        );
        bytes += content.length;
        if (bytes > maxBytes)
          throw new Error('Isolated source exceeds its byte limit');
        await writeFile(output, content, { flag: 'wx', mode: 0o644 });
        await chmod(output, 0o644);
        files.push({
          path,
          digest: createHash('sha256').update(content).digest('hex'),
        });
      } else
        throw new Error(
          'Isolated source must contain single-link regular files and directories',
        );
    }
  }
  await walk(root, target);
  await mkdir(join(target, '.doctopus'), { mode: 0o755 });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  directories.sort();
  return {
    digestVersion: 2 as const,
    bytes,
    files: files.length,
    digest: createHash('sha256')
      .update(JSON.stringify({ version: 2, files, directories }))
      .digest('hex'),
  };
}
