import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import type { SiteData } from '@davidniessen/doctopus-contracts';
import { applyPlugins, definePlugin } from './index.js';
import type { BuildPlugin } from './index.js';
import { pluginFile, pluginDigest } from './files.js';
import type { PluginInput } from './files.js';
import { applySourcePlugins } from './sources.js';
import type { SpecSource } from './sources.js';
async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > 256 * 1024 * 1024) throw new Error('Input limit exceeded');
    chunks.push(chunk as Buffer);
  }
  const { root, entries, site, sources, maxBytes } = JSON.parse(
    Buffer.concat(chunks).toString('utf8'),
  ) as {
    root: string;
    entries: PluginInput[];
    site?: SiteData;
    sources?: SpecSource[];
    maxBytes: number;
  };
  const plugins: BuildPlugin[] = [],
    metadata = [];
  let sourceBytes = 0;
  for (const entry of entries) {
    const file = await pluginFile(root, entry.path);
    sourceBytes += file.bytes;
    if (sourceBytes > 64 * 1024 * 1024)
      throw new Error('Source input limit exceeded');
    if (file.metadata.digest !== entry.digest) throw new Error('Entry changed');
    const imported = (await import(pathToFileURL(file.filename).href)) as {
      default: BuildPlugin;
    };
    const plugin = definePlugin(imported.default);
    const inputs = [entry];
    for (const path of plugin.inputs ?? []) {
      const loaded = await pluginFile(root, path);
      sourceBytes += loaded.bytes;
      if (sourceBytes > 64 * 1024 * 1024)
        throw new Error('Source input limit exceeded');
      const input = loaded.metadata;
      if (!inputs.some((known) => known.path === input.path))
        inputs.push(input);
    }
    inputs.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    metadata.push({
      name: plugin.name,
      version: plugin.version,
      sourceDigest: pluginDigest(inputs),
      inputs,
    });
    plugins.push(plugin);
  }
  const transformed = sources
    ? await applySourcePlugins(sources, plugins)
    : { site: await applyPlugins(site!, plugins) };
  for (const plugin of metadata)
    for (const input of plugin.inputs)
      if ((await pluginFile(root, input.path)).metadata.digest !== input.digest)
        throw new Error('Input changed during transform');
  const output = JSON.stringify({ ...transformed, plugins: metadata });
  if (Buffer.byteLength(output) > maxBytes)
    throw new Error('Output limit exceeded');
  const pipe = createWriteStream('', { fd: 3, autoClose: true });
  pipe.end(output);
  await finished(pipe);
}
void main().then(
  () => process.exit(0),
  () => process.exit(1),
);
