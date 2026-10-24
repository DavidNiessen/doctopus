import assert from 'node:assert/strict';

/** Fixtures must create only their own resources and publish only to loopback. */
export function assertOwnedCompose(
  configuration,
  project,
  image,
  { databaseImage } = {},
) {
  assert.match(
    project,
    /^doctopus-(?:runtime|restore|offline|upgrade|rollback)-[a-f0-9]{16}$/,
    'Use a unique owned fixture project',
  );
  assert.equal(configuration.name, project);
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(configuration.services).sort(), [
    'db',
    'docs',
    'migrate',
  ]);
  for (const entry of [
    ...Object.values(configuration.volumes ?? {}),
    ...Object.values(configuration.networks ?? {}),
  ])
    assert(
      !entry.external && entry.name.startsWith(project + '_'),
      'Acceptance must not reuse external deployment resources.',
    );
  assert.equal(configuration.networks.backend.internal, true);
  assert.equal(configuration.services.db.ports?.length ?? 0, 0);
  if (databaseImage !== undefined) {
    assert.match(databaseImage, /^sha256:[a-f0-9]{64}$/);
    assert.equal(configuration.services.db.image, databaseImage);
  } else
    assert.match(
      configuration.services.db.image,
      /^postgres:17-alpine@sha256:[a-f0-9]{64}$/,
    );
  assert.equal(configuration.services.docs.image, image);
  assert.equal(configuration.services.migrate.image, image);
  assert(configuration.services.docs.ports.length > 0);
  assert(
    configuration.services.docs.ports.every(
      (port) => port.host_ip === '127.0.0.1',
    ),
    'Fixture ports must bind to loopback.',
  );
}
