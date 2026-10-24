import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import type { Diagnostic, SiteData } from '@davidniessen/doctopus-contracts';
import { pluginFile, pluginDigest } from './files.js';
import type { PluginInput } from './files.js';
import { validatePluginSite } from './validation.js';
import { validateSpecSources } from './sources.js';
import type { SpecSource } from './sources.js';
import { z } from 'zod';

export interface PluginWorkerOptions {
  timeoutMs?: number;
  maxBytes?: number;
  heapMiB?: number;
}

export interface PluginExecution {
  site: SiteData;
  plugins: {
    name: string;
    version: string;
    sourceDigest: string;
    inputs: PluginInput[];
  }[];
}
export interface SourcePluginExecution {
  sources: SpecSource[];
  diagnostics: Diagnostic[];
  plugins: PluginExecution['plugins'];
}
/** Trusted-code resource boundary. This does not restrict filesystem, network or credentials. */
export async function runPluginFiles(
  root: string,
  paths: string[],
  site: SiteData,
  options: PluginWorkerOptions = {},
): Promise<PluginExecution> {
  const result = await runWorker(root, paths, { site }, options);
  try {
    return { site: validatePluginSite(result.site), plugins: result.plugins };
  } catch {
    throw new Error(
      'Trusted plugin output or declared inputs failed verification',
    );
  }
}

export async function runSourcePluginFiles(
  root: string,
  paths: string[],
  sources: SpecSource[],
  options: PluginWorkerOptions = {},
): Promise<SourcePluginExecution> {
  const inputs = structuredClone(validateSpecSources(sources));
  const result = await runWorker(root, paths, { sources: inputs }, options);
  try {
    const output = validateSpecSources(result.sources);
    if (
      output.length !== inputs.length ||
      output.some(
        (source, i) =>
          source.id !== inputs[i]!.id ||
          source.path !== inputs[i]!.path ||
          source.version !== inputs[i]!.version,
      )
    )
      throw new Error();
    const diagnostics = z
      .array(
        z
          .object({
            code: z.string().min(1).max(1024),
            severity: z.enum(['warning', 'error']),
            message: z.string().max(2 * 1024 * 1024),
            source: z
              .string()
              .max(2 * 1024 * 1024)
              .optional(),
          })
          .strict(),
      )
      .max(10_000)
      .parse(result.diagnostics);
    return {
      sources: output,
      diagnostics: diagnostics.map(({ source, ...rest }) =>
        source === undefined ? rest : { ...rest, source },
      ),
      plugins: result.plugins,
    };
  } catch {
    throw new Error(
      'Trusted plugin output or declared inputs failed verification',
    );
  }
}

async function runWorker(
  root: string,
  paths: string[],
  payload: { site: SiteData } | { sources: SpecSource[] },
  options: PluginWorkerOptions,
): Promise<{
  site?: unknown;
  sources?: unknown;
  diagnostics?: unknown;
  plugins: PluginExecution['plugins'];
}> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
  const heapMiB = options.heapMiB ?? 512;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 50 ||
    timeoutMs > 60_000 ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1024 ||
    maxBytes > 256 * 1024 * 1024 ||
    !Number.isInteger(heapMiB) ||
    heapMiB < 32 ||
    heapMiB > 1024
  )
    throw new Error('Invalid plugin worker limits');
  if (!paths.length || paths.length > 32)
    throw new Error('Run between 1 and 32 plugin files');
  root = await realpath(root);
  const entries = [];
  let sourceBytes = 0;
  for (const path of paths) {
    const entry = await pluginFile(root, path);
    sourceBytes += entry.bytes;
    if (sourceBytes > 64 * 1024 * 1024)
      throw new Error('Plugin source inputs exceed 64 MiB total');
    if (!/\.[cm]?js$/.test(entry.filename))
      throw new Error('Compile plugin entries to .js, .mjs or .cjs first');
    entries.push(entry.metadata);
  }
  const input = JSON.stringify({ root, entries, ...payload, maxBytes });
  if (Buffer.byteLength(input) > maxBytes)
    throw new Error('Plugin worker input exceeds its byte limit');
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${heapMiB}`,
        fileURLToPath(new URL('./worker.js', import.meta.url)),
      ],
      {
        cwd: root,
        detached: process.platform !== 'win32',
        // A dedicated pipe keeps arbitrary plugin logs out of both the protocol and parent logs.
        stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
      },
    );
    let done = false,
      bytes = 0;
    const chunks: Buffer[] = [];
    const kill = () => {
      try {
        if (process.platform !== 'win32' && child.pid)
          process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* The process group may already have exited. */
      }
    };
    const fail = (message: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      kill();
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail('Trusted plugin worker exceeded its execution limit'),
      timeoutMs,
    );
    child.once('error', () => fail('Unable to start trusted plugin worker'));
    child.stdin!.on('error', () => fail('Trusted plugin worker input failed'));
    const pipe = child.stdio[3] as Readable;
    pipe.on('error', () => fail('Trusted plugin worker output failed'));
    pipe.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail('Trusted plugin worker output exceeds its byte limit');
        return;
      }
      chunks.push(chunk);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      kill();
      if (code !== 0)
        reject(
          new Error(
            'Trusted plugin worker failed. Review plugin metadata, output, source inputs and resource limits.',
          ),
        );
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin!.end(input);
  });
  let result: {
    site?: unknown;
    sources?: unknown;
    diagnostics?: unknown;
    plugins: PluginExecution['plugins'];
  };
  try {
    result = JSON.parse(output) as typeof result;
    if (
      !Array.isArray(result.plugins) ||
      result.plugins.length !== paths.length
    )
      throw new Error();
    let verifiedBytes = 0;
    for (const plugin of result.plugins) {
      if (
        !Array.isArray(plugin.inputs) ||
        !plugin.inputs.length ||
        plugin.inputs.length > 129 ||
        pluginDigest(plugin.inputs) !== plugin.sourceDigest
      )
        throw new Error();
      for (const input of plugin.inputs) {
        const file = await pluginFile(root, input.path);
        verifiedBytes += file.bytes;
        if (
          verifiedBytes > 64 * 1024 * 1024 ||
          file.metadata.digest !== input.digest
        )
          throw new Error();
      }
    }
  } catch {
    throw new Error(
      'Trusted plugin output or declared inputs failed verification',
    );
  }
  return result;
}

/** Checks source text and declared input metadata in two independent workers. */
export async function checkSourcePluginConformance(
  root: string,
  paths: string[],
  sources: SpecSource[],
): Promise<SourcePluginExecution> {
  const first = await runSourcePluginFiles(root, paths, sources);
  const second = await runSourcePluginFiles(root, paths, sources);
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw new Error(
      'Plugin conformance failed: output or metadata differs between fresh executions',
    );
  return first;
}

/** Executes a reviewed plugin twice in fresh workers to check reproducibility on a fixture. */
export async function checkPluginConformance(
  root: string,
  paths: string[],
  site: SiteData,
): Promise<PluginExecution> {
  const first = await runPluginFiles(root, paths, site);
  const second = await runPluginFiles(root, paths, site);
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw new Error(
      'Plugin conformance failed: output or metadata differs between fresh executions',
    );
  return first;
}
