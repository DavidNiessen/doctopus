import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { shutdownTimeout } from '../apps/server/src/process-lifecycle.js';

const children: ChildProcess[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGKILL');
      await once(child, 'exit');
    }),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
function worker(scenario: string) {
  const root = mkdtempSync(join(tmpdir(), 'doctopus-process-'));
  roots.push(root);
  const child = spawn(
    process.execPath,
    ['tests/fixtures/server-process.mjs', scenario, root],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, LOG_LEVEL: 'silent' },
    },
  );
  children.push(child);
  const events: { event: string; address?: string }[] = [];
  let output = '';
  child.stdout!.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr!.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.on('message', (event) => {
    events.push(event as { event: string; address?: string });
  });
  const exited = once(child, 'exit');
  const wait = async (event: string) => {
    await expect
      .poll(() => events.find((item) => item.event === event), {
        timeout: 5000,
      })
      .toBeTruthy();
    return events.find((item) => item.event === event)!;
  };
  return { child, events, wait, exited, output: () => output };
}

it('drains a real in-flight HTTP request before closing resources once across repeated signals', async () => {
  const work = worker('normal');
  const { address } = await work.wait('listening');
  const pending = fetch(address + '/slow', {
    signal: AbortSignal.timeout(5000),
  });
  await work.wait('request-started');
  work.child.kill('SIGTERM');
  await work.wait('close-started');
  work.child.kill('SIGINT');
  work.child.kill('SIGTERM');
  const denied = await fetch(address + '/health/ready', {
    signal: AbortSignal.timeout(1000),
  }).then(
    (response) => response.status,
    () => 0,
  );
  expect([0, 503]).toContain(denied);
  expect(work.child.exitCode).toBe(null);
  expect(work.events.some((event) => event.event === 'repository-closed')).toBe(
    false,
  );
  work.child.send('release-request');
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ complete: true });
  expect(await work.exited, work.output()).toEqual([0, null]);
  expect(work.events.map((event) => event.event)).toEqual([
    'starting',
    'listening',
    'request-started',
    'close-started',
    'server-closed',
    'repository-closed',
  ]);
  expect(work.output()).toBe('');
});
it('finishes an already streaming keep-alive response without waiting for idle timeout', async () => {
  const work = worker('normal');
  const { address } = await work.wait('listening');
  const response = await fetch(address + '/stream', {
    signal: AbortSignal.timeout(5000),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('connection')).toBe('keep-alive');
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toBe('first\n');
  await work.wait('stream-started');
  work.child.kill('SIGTERM');
  await work.wait('close-started');
  work.child.send('release-request');
  const last = await reader.read();
  expect(new TextDecoder().decode(last.value)).toBe('last\n');
  expect((await reader.read()).done).toBe(true);
  reader.releaseLock();
  expect(await work.exited, work.output()).toEqual([0, null]);
  expect(
    work.events.filter((event) => event.event === 'repository-closed'),
  ).toHaveLength(1);
});
it('signals during startup await acquisition, skip listening and clean partially initialized resources', async () => {
  const work = worker('slow-start-success');
  await work.wait('starting');
  work.child.kill('SIGTERM');
  await work.wait('startup-aborted');
  work.child.send('release-start');
  expect(await work.exited, work.output()).toEqual([0, null]);
  expect(work.events.map((event) => event.event)).toEqual([
    'starting',
    'startup-aborted',
    'startup-cancelled',
    'close-started',
    'server-closed',
    'repository-closed',
  ]);
});
it('startup failures release resources and return a nonzero status without logging private exception details', async () => {
  const work = worker('startup-failure');
  expect(await work.exited).toEqual([1, null]);
  expect(work.events.map((event) => event.event)).toEqual([
    'starting',
    'close-started',
    'server-closed',
    'repository-closed',
  ]);
  expect(work.output()).toContain('Server startup failed.');
  expect(work.output()).not.toContain('private-startup-detail');
});
it('failed cleanup remains nonzero and does not expose exception details', async () => {
  const work = worker('close-failure');
  await work.wait('listening');
  work.child.kill('SIGTERM');
  expect(await work.exited).toEqual([1, null]);
  expect(work.output()).toContain('Server shutdown failed.');
  expect(work.output()).not.toContain('private-close-detail');
  expect(
    work.events.filter((event) => event.event === 'repository-closed'),
  ).toHaveLength(1);
});
it.each(['stuck-close', 'slow-start'])(
  'bounds a stalled %s with a nonzero process deadline',
  async (scenario) => {
    const work = worker(scenario);
    await work.wait(scenario === 'slow-start' ? 'starting' : 'listening');
    work.child.kill('SIGTERM');
    expect(await work.exited).toEqual([1, null]);
    expect(work.output()).toContain('Server shutdown exceeded its deadline.');
  },
);
it('accepts only bounded integer shutdown configuration', () => {
  expect(shutdownTimeout(undefined)).toBe(30000);
  expect(shutdownTimeout('1000')).toBe(1000);
  expect(shutdownTimeout('300000')).toBe(300000);
  for (const raw of [
    '',
    '999',
    '300001',
    'Infinity',
    '1e4',
    '-1',
    '1000.5',
    ' 1000',
    '001000',
    'private-value',
  ]) {
    expect(() => shutdownTimeout(raw)).toThrow(
      'SHUTDOWN_TIMEOUT_MS must be an integer from 1000 to 300000',
    );
    try {
      shutdownTimeout(raw);
    } catch (error) {
      expect(String(error)).not.toContain('private-value');
    }
  }
});
