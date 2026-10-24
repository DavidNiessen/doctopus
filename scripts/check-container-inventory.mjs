import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import {
  inventoryContext,
  requireCompleteInventory,
  scanner,
  sha256,
  validateContainerInventory,
} from './lib/container-inventory.mjs';

const image = process.argv[2];
assert(process.argv.length === 3, 'Select the exact tested server image ID');
assert.match(image, /^sha256:[a-f0-9]{64}$/);
const report = JSON.parse(
  await readFile('.doctopus/container-inventory-evidence.json', 'utf8'),
);
assert.equal(report.schemaVersion, 1);
assert.equal(report.resolvedImage, image);
assert.equal(report.toolVersion, toolVersion);
assert.deepEqual(report.scanner, scanner);
assert.equal(
  report.sourceCommit,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
assert.equal(
  report.sourceWorkingTreeDirty,
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
    .length > 0,
);
assert.equal(report.signed, false);
assert.equal(report.publicationApproved, false);
const root = await realpath('.doctopus/container-candidates');
const directory = await realpath(resolve(report.directory));
const local = relative(root, directory);
assert(
  local &&
    local !== '..' &&
    !local.startsWith('..' + sep) &&
    !isAbsolute(local),
  'Inventory must belong to the candidate directory',
);
await requireCompleteInventory(directory);
const path = await realpath(join(directory, 'server.cdx.json'));
assert.equal(
  relative(directory, path),
  'server.cdx.json',
  'Inventory must not follow an external link',
);
assert.equal(report.inventory.file, 'server.cdx.json');
assert.equal(
  await sha256(path),
  report.inventory.sha256,
  'Inventory checksum mismatch',
);
const bom = JSON.parse(await readFile(path, 'utf8'));
const counts = validateContainerInventory(
  bom,
  await inventoryContext(image, toolVersion),
);
assert.deepEqual(report.inventory, {
  file: 'server.cdx.json',
  sha256: report.inventory.sha256,
  format: bom.bomFormat,
  specVersion: bom.specVersion,
  components: bom.components.length,
  ...counts,
});
console.log(
  'Container inventory matches the tested image, scanner, source, package versions and checksum.',
);
