import { readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { confinedPath, readBoundedFile } from '@davidniessen/doctopus-spec';
import type { ProjectConfig } from '@davidniessen/doctopus-contracts';
const extensions = new Set([
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.css',
]);
export async function loadPublicAssets(
  root: string,
  config: ProjectConfig,
): Promise<Map<string, Buffer>> {
  const assets = new Map<string, Buffer>();
  let base: string;
  try {
    base = await confinedPath(root, config.assets ?? 'public');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await validateReferences();
    return assets;
  }
  let total = 0,
    entries = 0;
  async function walk(directory: string, depth = 0): Promise<void> {
    if (depth > 16) throw new Error('Public asset nesting exceeds 16 levels');
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      if (++entries > 2000)
        throw new Error('Public assets exceed 2000 entries');
      if (entry.isSymbolicLink())
        throw new Error(
          `Public asset symlinks are not supported: ${entry.name}`,
        );
      const file = await confinedPath(root, join(directory, entry.name));
      if (entry.isDirectory()) {
        await walk(file, depth + 1);
        continue;
      }
      if (!extensions.has(extname(entry.name).toLowerCase()))
        throw new Error(
          `Unsupported public asset ${entry.name}. Use raster images, fonts or reviewed CSS. SVG/HTML/JavaScript require a separately reviewed extension.`,
        );
      const value = await readBoundedFile(file);
      const extension = extname(file).toLowerCase();
      const signature = value.subarray(0, 16);
      const imageValid =
        extension === '.png'
          ? signature
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : ['.jpg', '.jpeg'].includes(extension)
            ? signature.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
            : extension === '.gif'
              ? ['GIF87a', 'GIF89a'].includes(
                  signature.subarray(0, 6).toString('ascii'),
                )
              : extension === '.webp'
                ? signature.subarray(0, 4).toString('ascii') === 'RIFF' &&
                  signature.subarray(8, 12).toString('ascii') === 'WEBP'
                : extension === '.ico'
                  ? signature.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))
                  : extension === '.avif'
                    ? signature.subarray(4, 8).toString('ascii') === 'ftyp' &&
                      /avi[fs]/.test(value.subarray(8, 64).toString('ascii'))
                    : true;
      if (!imageValid)
        throw new Error(
          `Asset image signature does not match its extension: ${entry.name}`,
        );
      total += value.length;
      if (total > 64 * 1024 * 1024)
        throw new Error('Public assets exceed 64 MiB');
      const path = relative(base, file).split('\\').join('/');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(path))
        throw new Error(`Use URL-safe public asset filenames: ${entry.name}`);
      assets.set(path, value);
    }
  }
  await walk(base);
  await validateReferences();
  return assets;
  async function validateReferences() {
    for (const path of [
      config.logo,
      config.logoDark,
      config.favicon,
      config.seo?.socialImage,
      config.theme.stylesheet,
    ]) {
      if (path && !assets.has(path))
        throw new Error(
          `Configured branding asset does not exist in ${config.assets ?? 'public'}: ${path}`,
        );
      if (
        path &&
        path !== config.theme.stylesheet &&
        !/\.(png|webp|jpe?g|gif|ico|avif)$/i.test(path)
      )
        throw new Error(
          `Branding image must be a supported raster image: ${path}`,
        );
    }
  }
}
