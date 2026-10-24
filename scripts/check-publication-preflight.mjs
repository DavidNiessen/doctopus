import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadContainerPublication } from './lib/container-publication.mjs';
import { inventoryContext } from './lib/container-inventory.mjs';
import { readRegularFile } from './lib/read-regular-file.mjs';
import { releaseSource } from './lib/release-assets.mjs';
import {
  bytesSha256,
  verifyPublicationPreflight,
} from './lib/publication-preflight.mjs';

assert.equal(process.argv.length, 2);
const root = process.cwd();
const source = await releaseSource(root, process.env, {
  workflow: 'release-publish.yml',
});
const plan = JSON.parse(
  await readRegularFile(join(root, '.doctopus/publication/plan.json')),
);
const context = { ...source, runId: plan.runId, runAttempt: plan.runAttempt };
const candidate = await loadContainerPublication(root, context, plan);
const expected = {
  context,
  publicationRunId: source.runId,
  publicationRunAttempt: source.runAttempt,
  image: candidate.image,
  archiveSha256: candidate.archive.sha256,
  lockSha256: bytesSha256(
    await readRegularFile('package-lock.json', 16 * 1024 * 1024),
  ),
  inventoryContext: await inventoryContext(candidate.image, source.version),
};
const verification = await verifyPublicationPreflight(
  join(root, '.doctopus/publication-preflight'),
  expected,
);
await writeFile(
  join(root, '.doctopus/publication/preflight-verification.json'),
  JSON.stringify(verification, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  'Fresh signed preflight matches this publication run, accepted image, current inventory and unsuppressed security policy.',
);
