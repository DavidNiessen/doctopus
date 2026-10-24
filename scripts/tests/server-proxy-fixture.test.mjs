import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyServerProxy } from '../lib/server-proxy-fixture.mjs';

const project = 'doctopus-runtime-' + 'a'.repeat(16);
const image = 'sha256:' + 'b'.repeat(64);
function source(docker) {
  return {
    project,
    image,
    root: tmpdir(),
    environment: {
      PUBLIC_URL: 'http://127.0.0.1:8080',
      INSECURE_DEVELOPMENT: 'true',
    },
    docker,
    compose: () =>
      assert.fail('Refused fixtures must not reconfigure a deployment.'),
    step() {},
    sanitize: (value) => value,
  };
}

test('TLS acceptance refuses foreign projects and mutable server images before any Docker command', async () => {
  const fixture = source(() => assert.fail('No Docker access is allowed.'));
  for (const overrides of [
    { project: 'doctopus' },
    { image: 'doctopus:local' },
  ])
    await assert.rejects(verifyServerProxy({ ...fixture, ...overrides }));
});

test('TLS acceptance does not adopt or remove an existing fixture label', async () => {
  const commands = [];
  const fixture = source(async (args) => {
    commands.push(args[0]);
    return 'c'.repeat(64);
  });
  await assert.rejects(verifyServerProxy(fixture));
  assert.deepEqual(commands, ['ps']);
});

test('TLS acceptance refuses a database network with an external route without changing deployment resources', async () => {
  const commands = [];
  const fixture = source(async (args) => {
    commands.push(args[0]);
    return args[0] === 'ps' ? '' : 'false';
  });
  const original = { ...fixture.environment };
  await assert.rejects(
    verifyServerProxy(fixture),
    /database fixture network must be private/,
  );
  assert(commands.every((command) => ['ps', 'network'].includes(command)));
  assert.deepEqual(fixture.environment, original);
});

test('TLS failure cleanup refuses a label match whose container name belongs to another resource', async (t) => {
  t.mock.method(console, 'error', () => {});
  const root = await mkdtemp(join(tmpdir(), 'doctopus-tls-guard-'));
  const commands = [];
  let created = false;
  const fixture = source(async (args) => {
    commands.push(args[0]);
    if (args[0] === 'ps') return created ? 'c'.repeat(64) : '';
    if (args[0] === 'network') return 'true';
    if (args[0] === 'image') return 'sha256:' + 'd'.repeat(64);
    if (args[0] === 'create') {
      created = true;
      return 'c'.repeat(64);
    }
    if (args[0] === 'start') throw new Error('Injected proxy start failure');
    if (args[0] === 'inspect') return '/foreign-container';
    assert.fail('Unexpected command after ownership mismatch: ' + args[0]);
  });
  try {
    await assert.rejects(
      verifyServerProxy({ ...fixture, root }),
      AggregateError,
    );
    assert(!commands.includes('rm'));
    assert(!commands.includes('logs'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
