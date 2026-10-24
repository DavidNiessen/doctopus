import { lstat, realpath, open, link, rename, rm } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  confinedPath,
  downloadSpec,
  readBoundedFile,
} from '@davidniessen/doctopus-spec';
import type { RemoteSpecOptions } from '@davidniessen/doctopus-spec';
import { digest } from '@davidniessen/doctopus-compiler';

export interface ImportSpecOptions extends RemoteSpecOptions {
  output?: string;
  replace?: boolean;
}
/** Save validated original bytes; failed imports never replace an existing spec. */
export async function importRemoteSpec(
  project: string,
  url: string,
  options: ImportSpecOptions,
) {
  const root = await realpath(resolve(project));
  const output = options.output ?? 'openapi.yaml';
  if (
    isAbsolute(output) ||
    [...output].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    }) ||
    !/\.(json|ya?ml)$/i.test(output)
  )
    throw new Error(
      'Spec output must be a relative JSON or YAML file inside the project',
    );
  const target = resolve(root, output);
  const local = relative(root, target);
  if (
    !local ||
    local === '..' ||
    local.startsWith('..' + sep) ||
    isAbsolute(local)
  )
    throw new Error('Spec output escapes the project');
  const parent = await confinedPath(root, dirname(target));
  const destination = join(parent, basename(target));
  let prior: Buffer | undefined;
  let mode = 0o600;
  try {
    const info = await lstat(destination);
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error('Spec output must be a regular file, not a symlink');
    if (!options.replace)
      throw new Error(
        'Spec output already exists; use --replace to refresh it',
      );
    prior = await readBoundedFile(destination);
    mode = info.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const snapshot = await downloadSpec(url, options);
  if (/\.json$/i.test(destination)) {
    try {
      JSON.parse(snapshot.source.toString('utf8'));
    } catch {
      throw new Error(
        'JSON output requires JSON source bytes; choose a YAML filename for YAML source',
      );
    }
  }
  const temporary = join(parent, '.doctopus-import-' + randomUUID());
  try {
    const file = await open(temporary, 'wx', mode);
    try {
      await file.writeFile(snapshot.source);
      await file.chmod(mode);
      await file.sync();
    } finally {
      await file.close();
    }
    if (prior) {
      const current = await readBoundedFile(destination);
      const currentInfo = await lstat(destination);
      if (
        digest(current) !== digest(prior) ||
        currentInfo.isSymbolicLink() ||
        (currentInfo.mode & 0o777) !== mode
      )
        throw new Error(
          'Spec output changed during the import; the local edit was preserved',
        );
      await rename(temporary, destination);
    } else {
      // Hard-link creation is atomic and cannot replace a concurrently created file.
      await link(temporary, destination);
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    path: relative(root, destination),
    sha256: snapshot.sha256,
    bytes: snapshot.source.length,
    origin: snapshot.origin,
  };
}
