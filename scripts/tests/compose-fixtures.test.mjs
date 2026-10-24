import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOwnedCompose } from '../lib/compose-fixtures.mjs';

const project = 'doctopus-runtime-' + 'a'.repeat(16);
const image = 'sha256:' + 'b'.repeat(64);
const configuration = {
  name: project,
  services: {
    db: { image: 'postgres:17-alpine@sha256:' + 'c'.repeat(64) },
    docs: { image, ports: [{ host_ip: '127.0.0.1', target: 8080 }] },
    migrate: { image },
  },
  networks: {
    backend: { name: project + '_backend', internal: true },
    frontend: { name: project + '_frontend' },
  },
  volumes: {
    database: { name: project + '_database' },
    artifacts: { name: project + '_artifacts' },
  },
};
test('accepts a private, loopback-only fixture with its own project resources and exact image', () => {
  assertOwnedCompose(configuration, project, image);
});
test('refuses external resources, another project, exposed listeners and different service images', () => {
  for (const change of [
    (value) => {
      value.name = 'doctopus';
    },
    (value) => {
      value.volumes.database.external = true;
    },
    (value) => {
      value.volumes.artifacts.name = 'user-artifacts';
    },
    (value) => {
      value.networks.frontend.external = true;
    },
    (value) => {
      value.networks.backend.internal = false;
    },
    (value) => {
      value.services.db.ports = [{ target: 5432, host_ip: '127.0.0.1' }];
    },
    (value) => {
      value.services.docs.ports[0].host_ip = '0.0.0.0';
    },
    (value) => {
      value.services.migrate.image = 'doctopus:local';
    },
    (value) => {
      value.services.other = {};
    },
  ]) {
    const value = structuredClone(configuration);
    change(value);
    assert.throws(() => assertOwnedCompose(value, project, image));
  }
});
test('refuses project names without the fixture nonce format before cleanup can select a deployment', () => {
  for (const name of [
    'doctopus',
    'doctopus-runtime',
    'doctopus-restore-test',
    'doctopus-offline-test',
    'doctopus-upgrade-test',
    'doctopus-rollback-test',
  ])
    assert.throws(() =>
      assertOwnedCompose({ ...configuration, name }, name, image),
    );
});

test('upgrade and rollback projects require the same owned resources and private listeners', () => {
  for (const kind of ['upgrade', 'rollback']) {
    const name = `doctopus-${kind}-${'d'.repeat(16)}`;
    const value = JSON.parse(
      JSON.stringify(configuration).replaceAll(project, name),
    );
    assertOwnedCompose(value, name, image);
    value.volumes.database.external = true;
    assert.throws(() => assertOwnedCompose(value, name, image));
  }
});

test('offline fixtures accept only their selected immutable imported database image', () => {
  const offlineProject = 'doctopus-offline-' + 'd'.repeat(16);
  const databaseImage = 'sha256:' + 'e'.repeat(64);
  const offline = JSON.parse(
    JSON.stringify(configuration).replaceAll(project, offlineProject),
  );
  offline.services.db.image = databaseImage;
  assertOwnedCompose(offline, offlineProject, image, { databaseImage });
  assert.throws(() => assertOwnedCompose(offline, offlineProject, image));
  for (const invalid of [
    '',
    null,
    'postgres:17-alpine',
    'sha256:' + 'f'.repeat(64),
  ])
    assert.throws(() =>
      assertOwnedCompose(offline, offlineProject, image, {
        databaseImage: invalid,
      }),
    );
});
