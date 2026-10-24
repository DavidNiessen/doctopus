import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readRegularFile } from './lib/read-regular-file.mjs';
import { releaseSource } from './lib/release-assets.mjs';
import {
  loadNpmPublication,
  publishNpmArchives,
  writeNpmPublicationReceiptDirectory,
} from './lib/npm-publication.mjs';

assert.equal(
  process.argv.length,
  2,
  'Use publish-npm.mjs only in the protected publishing job.',
);
const root = process.cwd();
const source = await releaseSource(root, process.env, {
  workflow: 'release-publish.yml',
});
const plan = JSON.parse(
  await readRegularFile(join(root, '.doctopus/publication/plan.json')),
);
assert.equal(plan.publicationRunId, source.runId);
assert.equal(plan.publicationRunAttempt, source.runAttempt);
assert(
  plan.environmentProtection?.reviewers > 0,
  'Verify the release environment before publishing.',
);
assert.equal(plan.environmentProtection.tagPolicy, 'v*');
const context = { ...source, runId: plan.runId, runAttempt: plan.runAttempt };
const candidate = await loadNpmPublication(root, context, plan);
await publishNpmArchives(candidate, {
  receiptPath: await writeNpmPublicationReceiptDirectory(root),
});
assert.deepEqual(
  await releaseSource(root, process.env, { workflow: 'release-publish.yml' }),
  source,
);
console.log(
  'The accepted npm archives are available from the selected registry with matching hashes. Fresh registry consumer acceptance is still required.',
);
