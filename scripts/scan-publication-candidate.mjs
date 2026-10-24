import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import {
  loadContainerPublication,
  runReleaseDocker,
} from './lib/container-publication.mjs';
import { releaseCommand } from './lib/release-command.mjs';
import { releaseSource, verifyReleaseAssets } from './lib/release-assets.mjs';
import {
  bytesSha256,
  assessPublicationPreflight,
} from './lib/publication-preflight.mjs';
import { readRegularFile } from './lib/read-regular-file.mjs';
import {
  inventoryContext,
  validateContainerInventory,
} from './lib/container-inventory.mjs';
import { validateContainerSecurity } from './lib/container-security.mjs';

const candidateMode =
  process.argv.length === 3 && process.argv[2] === '--candidate';
assert(
  process.argv.length === 2 || candidateMode,
  'Use scan-publication-candidate.mjs [--candidate].',
);
const root = process.cwd();
const source = await releaseSource(root, process.env, {
  workflow: candidateMode ? 'release-candidate.yml' : 'release-publish.yml',
});
let context, candidate;
if (candidateMode) {
  context = source;
  const directory = join(root, '.doctopus/release-assets/container');
  const manifest = await verifyReleaseAssets(directory, source, 'container');
  const archive = manifest.files.find((file) => file.name === 'server.tar.gz');
  assert(archive);
  candidate = { directory, image: manifest.image, archive };
} else {
  const plan = JSON.parse(
    await readRegularFile(join(root, '.doctopus/publication/plan.json')),
  );
  assert.equal(plan.publicationRunId, source.runId);
  assert.equal(plan.publicationRunAttempt, source.runAttempt);
  context = { ...source, runId: plan.runId, runAttempt: plan.runAttempt };
  candidate = await loadContainerPublication(root, context, plan);
}
const purpose = candidateMode ? 'candidate-rehearsal' : 'publication-preflight';
const config = await mkdtemp(join(tmpdir(), 'ad-scan-docker-'));
const run = (args) =>
  releaseCommand(process.execPath, args, {
    timeout: 900_000,
    maxBuffer: 4 * 1024 * 1024,
  });
const output = join(root, '.doctopus/publication-preflight');
await mkdir(output);
try {
  await releaseCommand('npm', ['audit', '--audit-level=moderate'], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const dependencyAudit = {
    passed: true,
    lockSha256: bytesSha256(
      await readRegularFile('package-lock.json', 16 * 1024 * 1024),
    ),
    auditedAt: new Date().toISOString(),
  };
  await runReleaseDocker(config, [
    'image',
    'load',
    '--input',
    join(candidate.directory, candidate.archive.name),
  ]);
  const loaded = await runReleaseDocker(config, [
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    candidate.image,
  ]);
  assert.equal(loaded.stdout.trim(), candidate.image);
  await run(['scripts/install-inventory-tool.mjs']);
  const inventory = await run([
    'scripts/container-inventory.mjs',
    candidate.image,
  ]);
  await writeFile(
    '.doctopus/container-inventory-evidence.json',
    inventory.stdout,
    { flag: 'wx' },
  );
  await run(['scripts/check-container-inventory.mjs', candidate.image]);
  await run(['scripts/install-security-tool.mjs']);
  const security = await run([
    'scripts/container-security.mjs',
    candidate.image,
  ]);
  await writeFile(
    '.doctopus/container-security-evidence.json',
    security.stdout,
    { flag: 'wx' },
  );
  await run(['scripts/check-container-security.mjs', candidate.image]);
  const inventoryReceipt = JSON.parse(inventory.stdout),
    securityReceipt = JSON.parse(security.stdout);
  for (const receipt of [inventoryReceipt, securityReceipt]) {
    assert.equal(receipt.sourceCommit, source.commit);
    assert.equal(receipt.sourceWorkingTreeDirty, false);
    assert.equal(receipt.resolvedImage, candidate.image);
    assert.equal(receipt.toolVersion, source.version);
  }
  // Scanner-owned result directories must remain inside their fixed candidate roots.
  async function raw(receipt, parent, name) {
    const base = await realpath(resolve(root, parent)),
      directory = await realpath(resolve(root, receipt.directory));
    const local = relative(base, directory);
    assert(
      local &&
        local !== '..' &&
        !local.startsWith('..' + sep) &&
        !isAbsolute(local),
    );
    return readRegularFile(join(directory, name), 64 * 1024 * 1024);
  }
  const inventoryBytes = await raw(
    inventoryReceipt,
    '.doctopus/container-candidates',
    'server.cdx.json',
  );
  const findingsBytes = await raw(
    securityReceipt,
    '.doctopus/container-security-candidates',
    'server.grype.json',
  );
  assert.equal(bytesSha256(inventoryBytes), inventoryReceipt.inventory.sha256);
  assert.equal(bytesSha256(findingsBytes), securityReceipt.findings.sha256);
  const expected = {
    purpose,
    context,
    publicationRunId: source.runId,
    publicationRunAttempt: source.runAttempt,
    image: candidate.image,
    archiveSha256: candidate.archive.sha256,
    lockSha256: dependencyAudit.lockSha256,
    inventoryContext: await inventoryContext(candidate.image, source.version),
  };
  const receipt = {
    schemaVersion: 1,
    purpose,
    ...context,
    publicationRunId: source.runId,
    publicationRunAttempt: source.runAttempt,
    image: candidate.image,
    archiveSha256: candidate.archive.sha256,
    inventorySha256: bytesSha256(inventoryBytes),
    findingsSha256: bytesSha256(findingsBytes),
    dependencyAudit,
    counts: validateContainerInventory(
      JSON.parse(inventoryBytes),
      expected.inventoryContext,
    ),
    assessment: validateContainerSecurity(
      JSON.parse(findingsBytes),
      candidate.image,
    ),
    complete: true,
  };
  assessPublicationPreflight(receipt, inventoryBytes, findingsBytes, expected);
  await writeFile(join(output, 'server.cdx.json'), inventoryBytes, {
    flag: 'wx',
  });
  await writeFile(join(output, 'server.grype.json'), findingsBytes, {
    flag: 'wx',
  });
  await writeFile(
    join(output, 'receipt.json'),
    JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx' },
  );
  assert.deepEqual(
    await releaseSource(root, process.env, {
      workflow: candidateMode ? 'release-candidate.yml' : 'release-publish.yml',
    }),
    source,
  );
  console.log(
    'Current dependency audit and fresh unsuppressed image scan pass for the exact accepted archive.',
  );
} finally {
  await rm(config, { recursive: true, force: true });
}
