import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyServerUpgrade } from '../lib/server-upgrade-fixture.mjs';

test('upgrade acceptance refuses foreign projects and mutable or identical images before Docker access', async () => {
  const source = {
    project: 'doctopus-runtime-' + 'a'.repeat(16),
    image: 'sha256:' + 'b'.repeat(64),
    baselineImage: 'sha256:' + 'c'.repeat(64),
  };
  for (const change of [
    { project: 'doctopus' },
    { image: 'doctopus:local' },
    { baselineImage: 'doctopus:old' },
    { baselineImage: source.image },
  ])
    await assert.rejects(
      verifyServerUpgrade({ ...source, ...change }),
      assert.AssertionError,
    );
});
