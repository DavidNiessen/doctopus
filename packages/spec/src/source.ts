import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export {
  record,
  text,
  array,
  parseSource,
  pointerEscape,
  pointerValue,
  resolvePointer,
} from './portable-source.js';

export async function confinedPath(
  root: string,
  path: string,
): Promise<string> {
  const chosenRoot = resolve(root),
    base = await realpath(chosenRoot),
    chosenTarget = resolve(chosenRoot, path);
  let requested = relative(chosenRoot, chosenTarget);
  // Accept either spelling of an explicitly selected symlink root, then resolve
  // from its canonical directory so a changed root alias cannot redirect the lookup.
  if (
    requested === '..' ||
    requested.startsWith('..' + sep) ||
    isAbsolute(requested)
  ) {
    requested = relative(base, chosenTarget);
    if (
      requested === '..' ||
      requested.startsWith('..' + sep) ||
      isAbsolute(requested)
    )
      throw new Error(`Path escapes the project: ${path}`);
  }
  const candidate = resolve(base, requested);
  if (candidate === base) return base;
  // Verify the actual lookup path as well as its relative spelling. Keep the
  // separator on the root prefix so a sibling with the same name cannot match.
  if (!candidate.startsWith(base.endsWith(sep) ? base : base + sep))
    throw new Error(`Path escapes the project: ${path}`);
  const target = await realpath(candidate);
  const local = relative(base, target);
  if (local === '..' || local.startsWith('..' + sep) || isAbsolute(local))
    throw new Error(`Path escapes the project: ${path}`);
  return target;
}
/** Bound reads before allocating the entire input, including files that grow after stat. */
export async function readBoundedFile(
  filename: string,
  limit = 16 * 1024 * 1024,
): Promise<Buffer> {
  const file = await open(
    filename,
    constants.O_RDONLY |
      (constants.O_NONBLOCK ?? 0) |
      (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile())
      throw new Error(`Input must be a regular file: ${filename}`);
    if (info.size > limit)
      throw new Error(`Input exceeds ${limit} bytes: ${filename}`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit - total + 1));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit)
        throw new Error(`Input exceeds ${limit} bytes: ${filename}`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await file.close();
  }
}
export async function readTextFile(
  filename: string,
  limit = 16 * 1024 * 1024,
): Promise<string> {
  return new TextDecoder('utf-8', { fatal: true }).decode(
    await readBoundedFile(filename, limit),
  );
}
