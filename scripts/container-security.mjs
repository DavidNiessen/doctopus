import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import { sha256, verifyScanner } from './lib/container-inventory.mjs';
import {
  validateContainerSecurity,
  vulnerabilityScanner,
} from './lib/container-security.mjs';

const image = process.argv[2];
assert.equal(
  process.argv.length,
  3,
  'Select the exact tested server image ID.',
);
assert.match(image, /^sha256:[a-f0-9]{64}$/);
const executable = resolve(
  '.doctopus/tools',
  `grype-${vulnerabilityScanner.version}`,
  'grype',
);
await verifyScanner(executable, vulnerabilityScanner);
await promisify(execFile)(
  process.execPath,
  ['scripts/check-container-inventory.mjs', image],
  { timeout: 30000, maxBuffer: 1024 * 1024 },
);
const inventory = JSON.parse(
  await readFile('.doctopus/container-inventory-evidence.json', 'utf8'),
);
const parent = resolve('.doctopus/container-security-candidates');
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(join(parent, image.slice(7, 19) + '-'));
await writeFile(
  join(directory, '.incomplete'),
  'Image vulnerability assessment is incomplete.\n',
  { flag: 'wx' },
);
const temporary = await mkdtemp(join(parent, '.scan-'));
try {
  const snapshot = join(temporary, 'server.cdx.json');
  const original = resolve(inventory.directory, inventory.inventory.file);
  await writeFile(snapshot, await readFile(original), {
    flag: 'wx',
    mode: 0o444,
  });
  assert.equal(
    await sha256(snapshot),
    inventory.inventory.sha256,
    'The security scan requires the verified inventory bytes.',
  );
  const configFile = join(temporary, 'grype.json');
  const databaseCache = resolve('.doctopus/tools/grype-db');
  await writeFile(
    configFile,
    JSON.stringify({
      'check-for-app-update': false,
      'only-fixed': false,
      'only-notfixed': false,
      'ignore-wontfix': '',
      ignore: [],
      exclude: [],
      'show-suppressed': true,
      'include-matcher-suppressions': true,
      'vex-documents': [],
      'vex-add': [],
      db: {
        'cache-dir': databaseCache,
        'auto-update': true,
        'require-update-check': true,
        'validate-age': true,
        'validate-by-hash-on-start': true,
        'max-allowed-built-age': '48h',
      },
    }),
    { flag: 'wx' },
  );
  const env = { ...process.env, TMPDIR: temporary };
  // Preserve proxy/CA/authentication context; the SBOM scan has no registry access.
  // Tool-specific inherited policy must not hide findings or replace our configuration.
  for (const key of Object.keys(env))
    if (key.startsWith('GRYPE_')) delete env[key];
  const raw = join(directory, 'server.grype.json');
  await promisify(execFile)(
    executable,
    [
      '--config',
      configFile,
      'sbom:' + snapshot,
      '--output',
      'json',
      '--file',
      raw,
    ],
    { env, timeout: 600000, maxBuffer: 1024 * 1024 },
  );
  const assessment = validateContainerSecurity(
    JSON.parse(await readFile(raw, 'utf8')),
    image,
  );
  assert.equal(await sha256(snapshot), inventory.inventory.sha256);
  const report = {
    schemaVersion: 1,
    toolVersion,
    resolvedImage: image,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    sourceWorkingTreeDirty:
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim().length > 0,
    scanner: vulnerabilityScanner,
    inventorySha256: inventory.inventory.sha256,
    directory: relative(resolve('.'), directory),
    findings: { file: 'server.grype.json', sha256: await sha256(raw) },
    assessment,
    signed: false,
    publicationApproved: false,
  };
  await writeFile(
    join(directory, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx' },
  );
  await unlink(join(directory, '.incomplete'));
  console.log(JSON.stringify(report, null, 2));
  if (!assessment.passed) process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
