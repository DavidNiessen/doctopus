import { spawn, fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import { dirname, join, isAbsolute, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { safeOutput, verifyArtifact } from '@davidniessen/doctopus-compiler';
import type {
  ArtifactManifest,
  IsolatedBuildLimits,
  SourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
import {
  toolVersion,
  isImmutableBuilderImage,
  isVisibleBuildConfig,
  readIsolatedBuildLimits,
} from '@davidniessen/doctopus-contracts';
import {
  confinedPath,
  readTextFile,
  parseConfig,
} from '@davidniessen/doctopus-spec';
import { validateSiteData } from '@davidniessen/doctopus-plugin-sdk';
import { snapshotProject } from './isolation-snapshot.js';
import { extractIsolatedArchive } from './isolation-archive.js';
import { activateDirectory } from './activate.js';

export interface IsolatedBuildOptions {
  image: string;
  /** Approved visible-source digest; checked before any Docker operation. */
  expectedSourceDigest?: string;
  socket?: string;
  config?: string;
  output?: string;
  trustPlugins?: boolean;
  trustContent?: boolean;
  timeoutMs?: number;
  memoryMiB?: number;
  cpus?: number;
  pids?: number;
  sourceMiB?: number;
  outputMiB?: number;
  signal?: AbortSignal;
}
export type IsolatedSourceInfo = SourceSnapshotInfo;
export interface IsolatedSourceOptions {
  sourceMiB?: number;
  signal?: AbortSignal;
}
export interface IsolatedBuildReceipt {
  schemaVersion: 1;
  toolVersion: string;
  image: string;
  source: IsolatedSourceInfo;
  artifactDigest: string;
  durationMs: number;
  limits: IsolatedBuildLimits;
  runtime: Record<string, unknown>;
}
const MiB = 1024 * 1024;
const selectors = [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
];
const proxyNames = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'FTP_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'ftp_proxy',
];
/** Inspect only bounded visible data, without evaluating project configuration or source code. */
export async function inspectIsolatedSource(
  project: string,
  options: IsolatedSourceOptions = {},
): Promise<IsolatedSourceInfo> {
  const limit =
    readIsolatedBuildLimits({ sourceMiB: options.sourceMiB }).sourceMiB * MiB;
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new Error('Use an AbortSignal for source inspection cancellation');
  options.signal?.throwIfAborted();
  const root = await realpath(project);
  const temporary = await mkdtemp(join(tmpdir(), 'doctopus-source-info-'));
  try {
    return await snapshotProject(
      root,
      join(temporary, 'source'),
      limit,
      options.signal,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Operator-only Docker boundary; the publication server does not execute source. */
export async function buildIsolatedSite(
  project: string,
  options: IsolatedBuildOptions,
): Promise<{
  directory: string;
  manifest: ArtifactManifest;
  receipt: IsolatedBuildReceipt;
}> {
  const started = Date.now();
  if (
    process.platform !== 'linux' ||
    !options ||
    !isImmutableBuilderImage(options.image)
  )
    throw new Error(
      'Isolated builds require Linux and an explicit immutable local image id or repository digest',
    );
  if (
    options.expectedSourceDigest !== undefined &&
    (typeof options.expectedSourceDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(options.expectedSourceDigest))
  )
    throw new Error('Expected source digest must be a lowercase SHA-256 value');
  for (const value of [options.trustPlugins, options.trustContent])
    if (value !== undefined && typeof value !== 'boolean')
      throw new Error('Trust options must be booleans');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new Error('Use an AbortSignal for isolated build cancellation');
  const limits = readIsolatedBuildLimits({
    timeoutMs: options.timeoutMs,
    memoryMiB: options.memoryMiB,
    cpus: options.cpus,
    pids: options.pids,
    sourceMiB: options.sourceMiB,
    outputMiB: options.outputMiB,
  });
  const config = options.config ?? 'docs.config.yaml';
  if (!isVisibleBuildConfig(config))
    throw new Error(
      'Isolated config must be a non-hidden project-relative path',
    );
  const root = await realpath(project);
  await confinedPath(root, config);
  const socket = await realpath(options.socket ?? '/var/run/docker.sock');
  if (!isAbsolute(socket) || !(await lstat(socket)).isSocket())
    throw new Error('Use a local Docker Unix socket');
  const environment = { ...process.env };
  for (const name of selectors) delete environment[name];
  const controller = new AbortController();
  const abort = () => controller.abort();
  const children = new Set<ChildProcess>();
  const onAbort = () => {
    for (const child of children) child.kill('SIGKILL');
  };
  function docker(
    args: string[],
    capture = true,
    cleanup = false,
  ): Promise<string> {
    if (!cleanup && controller.signal.aborted)
      return Promise.reject(new Error('Isolated build cancelled or timed out'));
    return new Promise((resolve, reject) => {
      const child = spawn('docker', [`--host=unix://${socket}`, ...args], {
        env: environment,
        stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'],
      });
      if (!cleanup) children.add(child);
      const chunks: Buffer[] = [];
      let size = 0,
        exceeded = false;
      const deadline = setTimeout(
        () => child.kill('SIGKILL'),
        cleanup ? 30_000 : limits.timeoutMs,
      );
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          exceeded = true;
          child.kill('SIGKILL');
        } else chunks.push(chunk);
      });
      child.once('error', () =>
        reject(new Error('Unable to invoke local Docker')),
      );
      child.once('close', (code) => {
        clearTimeout(deadline);
        children.delete(child);
        if (code === 0 && !exceeded)
          resolve(Buffer.concat(chunks).toString('utf8').trim());
        else reject(new Error('Local Docker operation failed'));
      });
    });
  }
  const directory = await safeOutput(root, options.output ?? '.doctopus/site');
  const workspace = relative(root, dirname(directory));
  const lockPath = join(dirname(directory), '.build.lock');
  const lock = await open(lockPath, 'wx').catch(() => {
    throw new Error(
      'Another build is active; inspect the publication lock before retrying',
    );
  });
  let job: string;
  try {
    job = await safeOutput(root, join(workspace, `isolated-${randomUUID()}`));
    await chmod(job, 0o700);
  } catch (error) {
    await lock.close();
    await rm(lockPath, { force: true });
    throw error;
  }
  const timer = setTimeout(
    abort,
    Math.max(1, limits.timeoutMs - (Date.now() - started)),
  );
  controller.signal.addEventListener('abort', onAbort);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let container: string | undefined,
    volume: string | undefined,
    watchdog: ChildProcess | undefined,
    removed = false,
    volumeRemoved = false;
  let phase = 'source snapshot';
  try {
    const sourceRoot = join(job, 'source'),
      stage = join(job, 'publication');
    await mkdir(stage, { mode: 0o700 });
    const source = await snapshotProject(
      root,
      sourceRoot,
      limits.sourceMiB * MiB,
      controller.signal,
    );
    phase = 'source digest verification';
    if (
      options.expectedSourceDigest !== undefined &&
      source.digest !== options.expectedSourceDigest
    )
      throw new Error('Source snapshot does not match its approved digest');
    phase = 'image verification';
    const image = await docker([
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      options.image,
    ]);
    if (!/^sha256:[a-f0-9]{64}$/.test(image))
      throw new Error('Unable to resolve immutable local builder image');
    phase = 'output allocation';
    volume = 'doctopus-build-' + randomUUID();
    await docker([
      'volume',
      'create',
      '--driver=local',
      '--opt=type=tmpfs',
      '--opt=device=tmpfs',
      `--opt=o=size=${limits.outputMiB}m,nr_inodes=60000,nosuid,nodev,noexec,mode=0700,uid=1000,gid=1000`,
      '--label=io.doctopus.isolated-output=true',
      volume,
    ]);
    const csv = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const args = [
      'create',
      '--pull=never',
      '--init',
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
      '--user=1000:1000',
      '--cgroupns=private',
      '--ipc=private',
      '--log-driver=none',
      '--restart=no',
      '--no-healthcheck',
      `--memory=${limits.memoryMiB}m`,
      `--memory-swap=${limits.memoryMiB}m`,
      `--cpus=${limits.cpus}`,
      `--pids-limit=${limits.pids}`,
      '--ulimit=core=0:0',
      '--ulimit=nofile=512:512',
      `--label=io.doctopus.isolated-job=${randomUUID()}`,
      '--mount',
      [
        'type=bind',
        csv('src=' + sourceRoot),
        'dst=/work/project',
        'readonly',
      ].join(','),
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,noexec,size=64m,mode=0700,uid=1000,gid=1000',
      '--mount',
      `type=volume,src=${volume},dst=/work/project/.doctopus,volume-nocopy`,
      '--workdir=/work/project',
      '--env=NODE_OPTIONS=',
      '--env=NODE_PATH=',
    ];
    for (const name of proxyNames) args.push(`--env=${name}=`);
    args.push(
      '--entrypoint=/usr/local/bin/node',
      image,
      '-e',
      `setTimeout(()=>process.exit(124),${limits.timeoutMs + 30_000});setInterval(()=>{},1000)`,
    );
    phase = 'container creation';
    container = await docker(args);
    if (!/^[a-f0-9]{64}$/.test(container))
      throw new Error('Docker did not return a valid container id');
    phase = 'watchdog startup';
    watchdog = fork(
      fileURLToPath(new URL('./isolation-watchdog.js', import.meta.url)),
      [socket, container, String(started + limits.timeoutMs + 30_000), volume],
      {
        env: environment,
        execArgv: [],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    watchdog.on('exit', () => {
      if (!removed) abort();
    });
    await new Promise<void>((resolve, reject) => {
      const waiting = setTimeout(
        () => reject(new Error('Isolated build watchdog unavailable')),
        5000,
      );
      watchdog!.once('message', (message) => {
        clearTimeout(waiting);
        if (message === 'ready') resolve();
        else reject(new Error('Invalid watchdog handshake'));
      });
      watchdog!.once('error', () => {
        clearTimeout(waiting);
        reject(new Error('Isolated build watchdog unavailable'));
      });
      watchdog!.once('exit', () => {
        clearTimeout(waiting);
        reject(new Error('Isolated build watchdog exited'));
      });
    });
    phase = 'runtime enforcement probe';
    await docker(['start', container]);
    const runtime = JSON.parse(
      await docker([
        'exec',
        container,
        '/usr/local/bin/node',
        '/app/packages/cli/dist/isolation-probe.js',
        String(limits.memoryMiB * MiB),
        String(limits.cpus),
        String(limits.pids),
        String(limits.outputMiB * MiB),
      ]),
    ) as Record<string, unknown>;
    if (runtime.toolVersion !== toolVersion)
      throw new Error('Builder and operator CLI versions must agree');
    // Confirm the freezer is available before executing any source code.
    await docker(['pause', container]);
    await docker(['unpause', container]);
    const build = [
      'exec',
      container,
      '/usr/local/bin/node',
      '/app/packages/cli/dist/main.js',
      'build',
      '/work/project',
      '--config',
      config,
    ];
    if (options.trustPlugins) build.push('--trust-plugins');
    if (options.trustContent) build.push('--trust-content');
    phase = 'build execution';
    await docker(build, false);
    await docker(['pause', container]);
    // All processes are frozen, including any detached descendants, before export.
    controller.signal.throwIfAborted();
    phase = 'archive export';
    const archive = spawn(
      'docker',
      [
        `--host=unix://${socket}`,
        'cp',
        `${container}:/work/project/.doctopus/site/.`,
        '-',
      ],
      { env: environment, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    children.add(archive);
    const finished = new Promise<void>((resolve, reject) => {
      archive.once('error', () => reject(new Error('Isolated export failed')));
      archive.once('close', (code) => {
        children.delete(archive);
        if (code === 0) resolve();
        else reject(new Error('Isolated export failed'));
      });
    });
    void finished.catch(() => {});
    const files = await extractIsolatedArchive(
      archive.stdout!,
      stage,
      limits.outputMiB * MiB,
      controller.signal,
    );
    await finished;
    phase = 'artifact verification';
    const manifest = await verifyArtifact(stage);
    if (
      manifest.compilerVersion !== toolVersion ||
      !Object.hasOwn(manifest.files, 'site.json') ||
      !Object.hasOwn(manifest.files, 'index.html') ||
      files.some(
        (path) =>
          path !== 'manifest.json' && !Object.hasOwn(manifest.files, path),
      )
    )
      throw new Error('Isolated publication inventory failed verification');
    const site = validateSiteData(
      JSON.parse(await readTextFile(join(stage, 'site.json'), 64 * MiB)),
    );
    const parsedConfig = parseConfig(site.config);
    if (site.config.basePath !== parsedConfig.basePath)
      throw new Error('Isolated publication configuration failed verification');
    await docker(['rm', '--force', container], false, true);
    removed = true;
    await docker(['volume', 'rm', volume], false, true);
    volumeRemoved = true;
    async function readable(path: string) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) {
          await readable(file);
          await chmod(file, 0o755);
        } else await chmod(file, 0o644);
      }
    }
    await readable(stage);
    await chmod(stage, 0o755);
    controller.signal.throwIfAborted();
    phase = 'publication activation';
    const previous = await safeOutput(
      root,
      join(workspace, `previous-${randomUUID()}`),
    );
    controller.signal.throwIfAborted();
    await activateDirectory(stage, directory, previous);
    return {
      directory,
      manifest,
      receipt: {
        schemaVersion: 1,
        toolVersion,
        image,
        source,
        artifactDigest: manifest.artifactDigest,
        durationMs: Date.now() - started,
        limits,
        runtime,
      },
    };
  } catch {
    throw new Error(
      controller.signal.aborted
        ? `Isolated build cancelled or exceeded its deadline during ${phase}; prior publication retained`
        : `Isolated build failed during ${phase}; prior publication retained`,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
    for (const child of children) child.kill('SIGKILL');
    if (container && !removed) {
      try {
        await docker(['rm', '--force', container], false, true);
        removed = true;
      } catch {
        /* The independent host watchdog retries cleanup. */
      }
    }
    if (volume && !volumeRemoved && (!container || removed)) {
      try {
        await docker(['volume', 'rm', volume], false, true);
        volumeRemoved = true;
      } catch {
        /* The watchdog retries its owned volume. */
      }
    }
    if (watchdog?.connected) {
      if (removed && volumeRemoved) watchdog.send('complete');
      else watchdog.disconnect();
    }
    await rm(job, { recursive: true, force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
