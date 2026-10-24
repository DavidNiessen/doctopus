import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import { readRegularFile } from './lib/read-regular-file.mjs';
import {
  validateContainerSecurity,
  vulnerabilityScanner,
} from './lib/container-security.mjs';

const image = process.argv[2];
assert.equal(process.argv.length, 3);
assert.match(image, /^sha256:[a-f0-9]{64}$/);
execFileSync(
  process.execPath,
  ['scripts/check-container-inventory.mjs', image],
  { timeout: 30000, maxBuffer: 1024 * 1024 },
);
const receipt = JSON.parse(
  await readFile('.doctopus/container-security-evidence.json', 'utf8'),
);
const inventory = JSON.parse(
  await readFile('.doctopus/container-inventory-evidence.json', 'utf8'),
);
assert.equal(receipt.schemaVersion, 1);
assert.equal(receipt.resolvedImage, image);
assert.equal(inventory.resolvedImage, image);
assert.equal(receipt.inventorySha256, inventory.inventory.sha256);
assert.equal(receipt.toolVersion, toolVersion);
assert.equal(
  receipt.sourceCommit,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
assert.equal(
  receipt.sourceWorkingTreeDirty,
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
    .length > 0,
);
assert.deepEqual(receipt.scanner, vulnerabilityScanner);
assert.equal(receipt.signed, false);
assert.equal(receipt.publicationApproved, false);
const root = await realpath('.doctopus/container-security-candidates');
const directory = await realpath(resolve(receipt.directory));
const local = relative(root, directory);
assert(
  local &&
    local !== '..' &&
    !local.startsWith('..' + sep) &&
    !isAbsolute(local),
);
await assert.rejects(lstat(join(directory, '.incomplete')), { code: 'ENOENT' });
assert.equal(receipt.findings.file, 'server.grype.json');
const raw = join(directory, receipt.findings.file);
assert.equal(relative(directory, await realpath(raw)), 'server.grype.json');
const bytes = await readRegularFile(raw, 64 * 1024 * 1024);
assert.equal(
  createHash('sha256').update(bytes).digest('hex'),
  receipt.findings.sha256,
);
const assessment = validateContainerSecurity(JSON.parse(bytes), image);
assert.deepEqual(receipt.assessment, assessment);
assert.equal(
  assessment.passed,
  true,
  'Blocking image vulnerabilities require remediation; this gate has no waiver mechanism.',
);
console.log(
  'Image security evidence matches the inventory, subject, source, fresh database and unsuppressed severity policy.',
);
