import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { protectionApi, protectionRepository } from './lib/protection-api.mjs';
import { inspectPublicationProtections } from './lib/publication-protection.mjs';

assert.equal(
  process.argv.length,
  2,
  'Use check-publication-protections.mjs without arguments.',
);
const root = fileURLToPath(new URL('../', import.meta.url));
const repository = await protectionRepository(root);
const result = await inspectPublicationProtections(
  root,
  repository,
  protectionApi(repository),
);
await writeFile(
  root + '.doctopus/publication/protection-verification.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result, null, 2));
