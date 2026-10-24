import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOfflineInstall } from '../lib/server-offline-fixture.mjs';

test('offline acceptance refuses foreign sources and mutable image selectors before accessing Docker or creating a deployment', async () => {
  const source = {
    project: 'doctopus-runtime-' + 'a'.repeat(16),
    image: 'sha256:' + 'b'.repeat(64),
    databaseReference: 'postgres:17-alpine@sha256:' + 'c'.repeat(64),
    docker: () => assert.fail('Refused image selectors must not reach Docker.'),
  };
  for (const overrides of [
    { project: 'doctopus' },
    { image: 'doctopus:local' },
    { databaseReference: 'postgres:17-alpine' },
    { databaseReference: 'postgres:18-alpine@sha256:' + 'c'.repeat(64) },
  ])
    await assert.rejects(verifyOfflineInstall({ ...source, ...overrides }));
});
