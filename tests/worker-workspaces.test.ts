import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
  link,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  markWorkerWorkspace,
  reclaimWorkerWorkspaces,
  workspaceEnvironment,
} from '../apps/worker/src/workspaces.js';
import type { WorkspaceEnvironment } from '../apps/worker/src/workspaces.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-worker-workspaces-'));
  const parent = join(root, '.doctopus/worker-jobs');
  await mkdir(parent, { recursive: true });
  let now = 1000000;
  const host: WorkspaceEnvironment = {
    pid: 123,
    startTicks: '456',
    bootId: randomUUID(),
    pidNamespace: 'pid:[123]',
    uptimeMs: () => now,
    processStartTicks: async () => undefined,
  };
  async function workspace() {
    const id = randomUUID();
    const directory = await mkdtemp(join(parent, `job-${id}-1-`));
    await markWorkerWorkspace(directory, id, 1, 15000, host);
    return directory;
  }
  return {
    root,
    parent,
    host,
    workspace,
    expire: () => {
      now += 135001;
    },
    close: () => rm(root, { recursive: true, force: true }),
    signal: new AbortController().signal,
  };
}
it('reclaims only expired dead-owned work including nested snapshots and stale locks', async () => {
  const f = await fixture();
  try {
    const directory = await f.workspace();
    await mkdir(join(directory, 'isolated-fixture/source'), {
      recursive: true,
    });
    await writeFile(
      join(directory, 'isolated-fixture/source/input.json'),
      '{}',
    );
    await writeFile(join(directory, '.build.lock'), '');
    await writeFile(join(f.root, 'openapi.json'), 'source remains');
    expect(await reclaimWorkerWorkspaces(f.root, f.signal, f.host)).toEqual({
      scanned: 1,
      removed: 0,
    });
    f.expire();
    expect(await reclaimWorkerWorkspaces(f.root, f.signal, f.host)).toEqual({
      scanned: 1,
      removed: 1,
    });
    expect(await readdir(f.parent)).toEqual([]);
    expect(await readFile(join(f.root, 'openapi.json'), 'utf8')).toBe(
      'source remains',
    );
  } finally {
    await f.close();
  }
});
it('retains a live owner after expiry and distinguishes a reused PID by its kernel start time', async () => {
  const f = await fixture();
  try {
    await f.workspace();
    f.expire();
    f.host.processStartTicks = async () => '456';
    expect(
      (await reclaimWorkerWorkspaces(f.root, f.signal, f.host)).removed,
    ).toBe(0);
    f.host.processStartTicks = async () => '789';
    expect(
      (await reclaimWorkerWorkspaces(f.root, f.signal, f.host)).removed,
    ).toBe(1);
  } finally {
    await f.close();
  }
});
it.each([
  { schemaVersion: 2 },
  { jobId: randomUUID() },
  { attempt: 2 },
  { bootId: randomUUID() },
  { pidNamespace: 'pid:[456]' },
  { pid: -1 },
  { startTicks: 'invalid' },
  { createdUptimeMs: 2000000, safeAfterUptimeMs: 2135000 },
  { safeAfterUptimeMs: 1000001 },
  { unexpected: true },
])('retains unknown or inconsistent ownership %j', async (patch) => {
  const f = await fixture();
  try {
    const directory = await f.workspace(),
      marker = join(directory, 'worker-owner.json');
    await writeFile(
      marker,
      JSON.stringify({
        ...JSON.parse(await readFile(marker, 'utf8')),
        ...patch,
      }),
    );
    f.expire();
    expect(
      (await reclaimWorkerWorkspaces(f.root, f.signal, f.host)).removed,
    ).toBe(0);
    expect(await readdir(f.parent)).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it('retains unreadable process identity, missing/malformed/oversized markers and unrecognized paths', async () => {
  const f = await fixture();
  try {
    const directory = await f.workspace();
    const missing = await f.workspace();
    await rm(join(missing, 'worker-owner.json'));
    const malformed = await f.workspace();
    await writeFile(join(malformed, 'worker-owner.json'), '{');
    const oversized = await f.workspace();
    await writeFile(join(oversized, 'worker-owner.json'), ' '.repeat(4097));
    await mkdir(join(f.parent, 'notes'));
    f.expire();
    f.host.processStartTicks = async () => {
      throw Object.assign(new Error('Access denied'), { code: 'EACCES' });
    };
    expect(
      (await reclaimWorkerWorkspaces(f.root, f.signal, f.host)).removed,
    ).toBe(0);
    expect(
      await readFile(join(directory, 'worker-owner.json'), 'utf8'),
    ).toContain('schemaVersion');
    expect(await readdir(f.parent)).toHaveLength(5);
  } finally {
    await f.close();
  }
});
it('does not follow workspace/marker links or hardlinked markers, and deleting nested links preserves their targets', async () => {
  const f = await fixture();
  try {
    const external = join(f.root, 'outside');
    await mkdir(external);
    await writeFile(join(external, 'sentinel'), 'retained');
    await symlink(external, join(f.parent, `job-${randomUUID()}-1-ABC123`));
    const linkedMarker = await f.workspace(),
      marker = join(linkedMarker, 'worker-owner.json');
    await rm(marker);
    await symlink(join(external, 'sentinel'), marker);
    const hardlinked = await f.workspace();
    await link(
      join(hardlinked, 'worker-owner.json'),
      join(external, 'marker-copy'),
    );
    const removable = await f.workspace();
    await symlink(external, join(removable, 'nested-link'));
    f.expire();
    expect(
      (await reclaimWorkerWorkspaces(f.root, f.signal, f.host)).removed,
    ).toBe(1);
    expect(await readFile(join(external, 'sentinel'), 'utf8')).toBe('retained');
    expect(await readdir(f.parent)).toHaveLength(3);
  } finally {
    await f.close();
  }
});
it('refuses a linked workspace parent before inspecting or deleting external entries', async () => {
  const f = await fixture();
  try {
    const external = join(f.root, 'outside');
    await mkdir(external);
    await writeFile(join(external, 'sentinel'), 'retained');
    await rm(f.parent, { recursive: true });
    await symlink(external, f.parent);
    await expect(
      reclaimWorkerWorkspaces(f.root, f.signal, f.host),
    ).rejects.toThrow(/symlinks/);
    expect(await readFile(join(external, 'sentinel'), 'utf8')).toBe('retained');
  } finally {
    await f.close();
  }
});
it('bounds each sweep and makes progress on the remaining expired directories', async () => {
  const f = await fixture();
  try {
    await Promise.all(Array.from({ length: 101 }, () => f.workspace()));
    f.expire();
    expect(await reclaimWorkerWorkspaces(f.root, f.signal, f.host)).toEqual({
      scanned: 100,
      removed: 100,
    });
    expect(await reclaimWorkerWorkspaces(f.root, f.signal, f.host)).toEqual({
      scanned: 1,
      removed: 1,
    });
  } finally {
    await f.close();
  }
});
it('stops reclamation on shutdown, including an abort immediately before deletion', async () => {
  const f = await fixture();
  try {
    await f.workspace();
    f.expire();
    const controller = new AbortController();
    f.host.processStartTicks = async () => {
      controller.abort();
      return undefined;
    };
    await expect(
      reclaimWorkerWorkspaces(f.root, controller.signal, f.host),
    ).rejects.toThrow();
    expect(await readdir(f.parent)).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it('uses actual Linux process identity to retain an expired workspace owned by the current process', async () => {
  const f = await fixture();
  try {
    const id = randomUUID(),
      directory = await mkdtemp(join(f.parent, `job-${id}-1-`));
    await markWorkerWorkspace(directory, id, 1, 15000);
    const owner = JSON.parse(
      await readFile(join(directory, 'worker-owner.json'), 'utf8'),
    );
    expect(owner.pid).toBe(process.pid);
    const local = await workspaceEnvironment();
    const expired = { ...local, uptimeMs: () => local.uptimeMs() + 135001 };
    expect(
      (await reclaimWorkerWorkspaces(f.root, f.signal, expired)).removed,
    ).toBe(0);
  } finally {
    await f.close();
  }
});
