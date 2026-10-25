import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(
  new URL('../packages/spec/package.json', import.meta.url),
);
const { default: Ajv } = require('ajv/dist/2020.js');
const { default: standalone } = require('ajv/dist/standalone/index.js');
// Compile during product development, never in a consumer's browser. The
// standalone validator works with script-src 'self' and requires no eval.
const ajv = new Ajv({
  strict: false,
  validateFormats: false,
  code: { source: true },
});
const validate = ajv.getSchema('https://json-schema.org/draft/2020-12/schema');
const directory = new URL('../packages/spec/dist/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL('schema-meta-validator.cjs', directory),
  standalone(ajv, validate),
);
