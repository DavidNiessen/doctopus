import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadContainerPublication,
  publishContainerArchive,
} from './lib/container-publication.mjs';
import { releaseSource } from './lib/release-assets.mjs';
import { readRegularFile } from './lib/read-regular-file.mjs';

assert.equal(process.argv.length, 2);
const root = process.cwd();
const source = await releaseSource(root, process.env, {
  workflow: 'release-publish.yml',
});
const plan = JSON.parse(
  await readRegularFile(join(root, '.doctopus/publication/plan.json')),
);
assert.equal(plan.publicationRunId, source.runId);
assert.equal(plan.publicationRunAttempt, source.runAttempt);
assert(plan.environmentProtection?.reviewers > 0);
assert.equal(plan.environmentProtection.tagPolicy, 'v*');
const context = { ...source, runId: plan.runId, runAttempt: plan.runAttempt };
const candidate = await loadContainerPublication(root, context, plan);
const result = await publishContainerArchive(candidate, {
  receiptPath: join(root, '.doctopus/publication/container-result.json'),
});
await writeFile(
  join(root, '.doctopus/publication/promotion-predicate.json'),
  JSON.stringify(result.predicate, null, 2) + '\n',
  { flag: 'wx' },
);
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `repository=${candidate.repository}\ndigest=${result.digest}\n`,
  );
assert.deepEqual(
  await releaseSource(root, process.env, { workflow: 'release-publish.yml' }),
  source,
);
console.log(
  'The tested container config is published. Promotion attestation and anonymous public verification remain required.',
);
