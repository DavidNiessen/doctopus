import { isAbsolute, relative, sep } from 'node:path';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { readTextFile } from '@davidniessen/doctopus-spec';
import {
  readBuildPolicy,
  readSourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
import type {
  BuildPolicy,
  SourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
export interface PreparedSource {
  id: string;
  projectId: string;
  directory: string;
  snapshot: SourceSnapshotInfo;
  policy: BuildPolicy;
}
export interface WorkerConfig {
  schemaVersion: 1;
  serverUrl: string;
  workerId: string;
  artifactRoot: string;
  insecureDevelopment: boolean;
  maxConcurrency: number;
  maxMemoryMiB: number;
  maxCpus: number;
  pollMs: number;
  sources: PreparedSource[];
}
export function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error('Invalid worker configuration or protocol');
  return value as Record<string, unknown>;
}
export function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
  )
    throw new Error('Invalid worker identifier');
  return value.toLowerCase();
}
function directory(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    !isAbsolute(value) ||
    value.includes('\0')
  )
    throw new Error('Worker directories must be absolute local paths');
  return value;
}
function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error('Invalid worker resource or polling limit');
  return value;
}
export function readWorkerOrigin(
  value: unknown,
  insecureDevelopment = false,
): string {
  if (typeof value !== 'string' || value.length > 2048)
    throw new Error('Invalid worker control-plane origin');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid worker control-plane origin');
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        insecureDevelopment &&
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      ))
  )
    throw new Error(
      'Worker control plane requires HTTPS or explicit loopback development',
    );
  return url.origin;
}
/** Read operator data only; no source config, imports, network or Docker. */
export function readWorkerConfig(value: unknown): WorkerConfig {
  const input = record(value, [
    'schemaVersion',
    'serverUrl',
    'workerId',
    'artifactRoot',
    'insecureDevelopment',
    'maxConcurrency',
    'maxMemoryMiB',
    'maxCpus',
    'pollMs',
    'sources',
  ]);
  if (
    input.schemaVersion !== 1 ||
    typeof input.serverUrl !== 'string' ||
    input.serverUrl.length > 2048 ||
    typeof input.workerId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(input.workerId) ||
    (input.insecureDevelopment !== undefined &&
      typeof input.insecureDevelopment !== 'boolean')
  )
    throw new Error('Invalid worker identity or control-plane origin');
  const insecureDevelopment = input.insecureDevelopment === true;
  const serverUrl = readWorkerOrigin(input.serverUrl, insecureDevelopment);
  const maxMemoryMiB = integer(input.maxMemoryMiB, 2048, 512, 16384);
  const maxCpus = integer(input.maxCpus, 2, 1, 16);
  if (
    !Array.isArray(input.sources) ||
    !input.sources.length ||
    input.sources.length > 1000
  )
    throw new Error('Worker requires 1–1000 prepared sources');
  const identities = new Set<string>();
  const sources = input.sources.map((value) => {
    const source = record(value, [
      'id',
      'projectId',
      'directory',
      'snapshot',
      'policy',
    ]);
    const id = identifier(source.id);
    if (identities.has(id)) throw new Error('Duplicate worker source approval');
    identities.add(id);
    const snapshot = readSourceSnapshotInfo(source.snapshot);
    const policy = readBuildPolicy(source.policy);
    if (
      !snapshot.files ||
      !snapshot.bytes ||
      snapshot.bytes > policy.limits.sourceMiB * 1024 * 1024 ||
      policy.limits.memoryMiB > maxMemoryMiB ||
      policy.limits.cpus > maxCpus
    )
      throw new Error('Prepared source exceeds worker or policy budget');
    return {
      id,
      projectId: identifier(source.projectId),
      directory: directory(source.directory),
      snapshot,
      policy,
    };
  });
  return {
    schemaVersion: 1,
    serverUrl,
    workerId: input.workerId,
    artifactRoot: directory(input.artifactRoot),
    insecureDevelopment,
    maxConcurrency: integer(input.maxConcurrency, 1, 1, 4),
    maxMemoryMiB,
    maxCpus,
    pollMs: integer(input.pollMs, 2000, 1000, 30000),
    sources,
  };
}
const within = (root: string, file: string) => {
  const path = relative(root, file);
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep))
  );
};
/** Resolve local ownership before any claim. Keep control-plane secrets outside sources/storage. */
export async function loadWorkerConfig(
  file: string,
  credentialFile?: string,
): Promise<WorkerConfig> {
  const configPath = await realpath(file);
  const config = readWorkerConfig(
    JSON.parse(await readTextFile(configPath, 4 * 1024 * 1024)),
  );
  const secretPath = credentialFile
    ? await realpath(credentialFile)
    : undefined;
  await mkdir(config.artifactRoot, { recursive: true, mode: 0o750 });
  config.artifactRoot = await realpath(config.artifactRoot);
  for (const source of config.sources) {
    source.directory = await realpath(source.directory);
    if (!(await stat(source.directory)).isDirectory())
      throw new Error('Prepared source must be a local directory');
    if (
      within(source.directory, config.artifactRoot) ||
      within(config.artifactRoot, source.directory) ||
      within(source.directory, configPath) ||
      (secretPath && within(source.directory, secretPath))
    )
      throw new Error(
        'Keep worker control files and artifact storage outside prepared sources',
      );
  }
  if (
    within(config.artifactRoot, configPath) ||
    (secretPath && within(config.artifactRoot, secretPath))
  )
    throw new Error('Keep worker control files outside artifact storage');
  return config;
}
