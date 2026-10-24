import assert from 'node:assert/strict';
import { join } from 'node:path';
import { releaseSource, verifyReleaseAssets } from './lib/release-assets.mjs';
import { verifyProducerProvenance } from './lib/provenance-verification.mjs';

assert.equal(
  process.argv.length,
  2,
  'Use verify-release-assets.mjs without arguments.',
);
const context = await releaseSource(process.cwd());
for (const kind of ['npm', 'java', 'container']) {
  const directory = join('.doctopus/release-assets', kind);
  const manifest = await verifyReleaseAssets(directory, context, kind);
  console.log(
    `${kind}: ${manifest.files.length} exact assets bound to ${context.ref}, run ${context.runId}/${context.runAttempt}.`,
  );
}
const proof = await verifyProducerProvenance(process.cwd(), context);
console.log(
  `Verified bytes and producer provenance for ${proof.subjects.length} subjects; this is not publication approval.`,
);
