import {
  lstat,
  opendir,
  readFile,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import { uptime } from 'node:os';
import { basename, join } from 'node:path';
import { safeOutput } from '@davidniessen/doctopus-compiler';
import { readTextFile } from '@davidniessen/doctopus-spec';
import { record, identifier } from './config.js';

const markerName = 'worker-owner.json';
const workspacePattern =
  /^job-([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})-([1-3])-([A-Za-z0-9]{6})$/;
interface WorkspaceOwner {
  schemaVersion: 1;
  jobId: string;
  attempt: number;
  pid: number;
  startTicks: string;
  bootId: string;
  pidNamespace: string;
  createdUptimeMs: number;
  safeAfterUptimeMs: number;
}
/** Private dependency seam for deterministic expiry and process-identity acceptance. */
export interface WorkspaceEnvironment {
  pid: number;
  startTicks: string;
  bootId: string;
  pidNamespace: string;
  uptimeMs: () => number;
  processStartTicks: (pid: number) => Promise<string | undefined>;
}
async function processStartTicks(pid: number): Promise<string | undefined> {
  try {
    const source = await readTextFile(`/proc/${pid}/stat`, 4096);
    const value = source
      .slice(source.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/)[19];
    if (!value || !/^\d{1,30}$/.test(value))
      throw new Error('Unavailable process identity');
    return value;
  } catch (error) {
    if (
      ['ENOENT', 'ESRCH', 'ENOTDIR'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    )
      return undefined;
    throw error; // Permission/format errors establish no permission to delete.
  }
}
let environment: Promise<WorkspaceEnvironment> | undefined;
export function workspaceEnvironment() {
  return (environment ??= (async () => {
    const startTicks = await processStartTicks(process.pid);
    if (!startTicks) throw new Error('Unavailable worker process identity');
    return {
      pid: process.pid,
      startTicks,
      bootId: identifier(
        (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
      ),
      pidNamespace: await readlink('/proc/self/ns/pid'),
      uptimeMs: () => Math.floor(uptime() * 1000),
      processStartTicks,
    };
  })());
}
function readOwner(value: unknown): WorkspaceOwner {
  const input = record(value, [
    'schemaVersion',
    'jobId',
    'attempt',
    'pid',
    'startTicks',
    'bootId',
    'pidNamespace',
    'createdUptimeMs',
    'safeAfterUptimeMs',
  ]);
  if (
    input.schemaVersion !== 1 ||
    !Number.isSafeInteger(input.attempt) ||
    (input.attempt as number) < 1 ||
    (input.attempt as number) > 3 ||
    !Number.isSafeInteger(input.pid) ||
    (input.pid as number) < 1 ||
    (input.pid as number) > 2147483647 ||
    typeof input.pidNamespace !== 'string' ||
    !/^pid:\[\d{1,20}\]$/.test(input.pidNamespace) ||
    typeof input.startTicks !== 'string' ||
    !/^\d{1,30}$/.test(input.startTicks) ||
    !Number.isSafeInteger(input.createdUptimeMs) ||
    (input.createdUptimeMs as number) < 0 ||
    !Number.isSafeInteger(input.safeAfterUptimeMs)
  )
    throw new Error('Invalid workspace ownership');
  const window =
    (input.safeAfterUptimeMs as number) - (input.createdUptimeMs as number);
  if (window < 121000 || window > 1020000)
    throw new Error('Invalid workspace recovery window');
  return {
    schemaVersion: 1,
    jobId: identifier(input.jobId),
    attempt: input.attempt as number,
    pid: input.pid as number,
    startTicks: input.startTicks,
    bootId: identifier(input.bootId),
    pidNamespace: input.pidNamespace,
    createdUptimeMs: input.createdUptimeMs as number,
    safeAfterUptimeMs: input.safeAfterUptimeMs as number,
  };
}
export async function markWorkerWorkspace(
  directory: string,
  jobId: string,
  attempt: number,
  timeoutMs: number,
  host?: WorkspaceEnvironment,
): Promise<void> {
  const current = host ?? (await workspaceEnvironment());
  const match = workspacePattern.exec(basename(directory));
  if (!match || match[1] !== jobId || Number(match[2]) !== attempt)
    throw new Error('Invalid owned workspace path');
  const createdUptimeMs = current.uptimeMs();
  const owner = readOwner({
    schemaVersion: 1,
    jobId,
    attempt,
    pid: current.pid,
    startTicks: current.startTicks,
    bootId: current.bootId,
    pidNamespace: current.pidNamespace,
    createdUptimeMs,
    safeAfterUptimeMs: createdUptimeMs + timeoutMs + 120000,
  });
  await writeFile(join(directory, markerName), JSON.stringify(owner), {
    flag: 'wx',
    mode: 0o600,
  });
}
/** Delete only expired work from a proven-dead process on this same kernel boot. */
export async function reclaimWorkerWorkspaces(
  sourceDirectory: string,
  signal: AbortSignal,
  host?: WorkspaceEnvironment,
): Promise<{ scanned: number; removed: number }> {
  signal.throwIfAborted();
  const current = host ?? (await workspaceEnvironment());
  const parent = await safeOutput(sourceDirectory, '.doctopus/worker-jobs');
  const parentIdentity = await lstat(parent);
  let scanned = 0,
    removed = 0;
  for await (const entry of await opendir(parent)) {
    signal.throwIfAborted();
    if (++scanned > 100) break;
    const match = workspacePattern.exec(entry.name);
    if (!match || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = join(parent, entry.name);
    try {
      const before = await lstat(directory);
      if (!before.isDirectory() || before.isSymbolicLink()) continue;
      const marker = join(directory, markerName);
      const markerInfo = await lstat(marker);
      if (
        !markerInfo.isFile() ||
        markerInfo.isSymbolicLink() ||
        markerInfo.nlink !== 1
      )
        continue;
      const owner = readOwner(JSON.parse(await readTextFile(marker, 4096)));
      if (
        owner.jobId !== match[1] ||
        owner.attempt !== Number(match[2]) ||
        owner.bootId !== current.bootId ||
        owner.pidNamespace !== current.pidNamespace ||
        owner.createdUptimeMs > current.uptimeMs() ||
        owner.safeAfterUptimeMs > current.uptimeMs()
      )
        continue;
      if ((await current.processStartTicks(owner.pid)) === owner.startTicks)
        continue;
      signal.throwIfAborted();
      const after = await lstat(directory),
        parentAfter = await lstat(parent);
      if (
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        before.ino !== after.ino ||
        before.dev !== after.dev ||
        !parentAfter.isDirectory() ||
        parentAfter.isSymbolicLink() ||
        parentIdentity.ino !== parentAfter.ino ||
        parentIdentity.dev !== parentAfter.dev
      )
        continue;
      await rm(directory, { recursive: true, force: false });
      removed++;
    } catch {
      signal.throwIfAborted();
      // Unknown, changed, unreadable or concurrently cleaned paths are retained.
    }
  }
  return { scanned: Math.min(scanned, 100), removed };
}
