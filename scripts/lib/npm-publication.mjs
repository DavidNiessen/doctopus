import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { npmPublicationOrder } from './publication-policy.mjs';
import { readRegularFile } from './read-regular-file.mjs';
import { releaseRequest } from './release-http.mjs';
import { verifyReleaseAssets } from './release-assets.mjs';
import { readWorkspacePackages } from './workspaces.mjs';
import { githubNpmRegistry, githubPackageHeaders } from './github-packages.mjs';

const exec = promisify(execFile);
const registry = 'https://registry.npmjs.org';
const digest = (bytes, algorithm, encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);

/** Compare public registry bytes, not only a version string or registry metadata. */
export async function inspectNpmVersion(
  pkg,
  {
    request = releaseRequest,
    registry: destination = registry,
    env = process.env,
    acceptArchive = async () => {},
  } = {},
) {
  assert(
    destination === registry || destination === githubNpmRegistry,
    'Unexpected npm registry.',
  );
  const headers =
    destination === githubNpmRegistry
      ? githubPackageHeaders('npm', env)
      : undefined;
  assert.match(pkg.name, /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/);
  assert.match(pkg.version, /^[0-9][a-zA-Z0-9.-]{0,99}$/);
  assert.match(pkg.sha256, /^[a-f0-9]{64}$/);
  assert.match(pkg.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  assert(
    Number.isSafeInteger(pkg.bytes) &&
      pkg.bytes > 0 &&
      pkg.bytes <= 64 * 1024 * 1024,
  );
  const result = await request(
    `${destination}/${encodeURIComponent(pkg.name)}` +
      (destination === registry ? `/${encodeURIComponent(pkg.version)}` : ''),
    { headers },
  );
  if (result.status === 404) return { exists: false };
  assert.equal(
    result.status,
    200,
    `Cannot inspect npm publication ${pkg.name}.`,
  );
  const document = JSON.parse(result.bytes.toString('utf8'));
  if (destination === githubNpmRegistry) {
    assert.equal(document.name, pkg.name);
    assert(
      document.versions &&
        typeof document.versions === 'object' &&
        !Array.isArray(document.versions),
      'Malformed GitHub npm package metadata.',
    );
  }
  const metadata =
    destination === githubNpmRegistry
      ? document.versions?.[pkg.version]
      : document;
  if (destination === githubNpmRegistry && metadata === undefined)
    return { exists: false };
  assert.equal(metadata.name, pkg.name);
  assert.equal(metadata.version, pkg.version);
  assert.equal(
    metadata.dist?.integrity,
    pkg.integrity,
    `Existing npm version has different bytes: ${pkg.name}.`,
  );
  let provenance;
  if (destination === registry) {
    assert.equal(
      metadata.dist.attestations?.provenance?.predicateType,
      'https://slsa.dev/provenance/v1',
      'Published npm provenance is missing.',
    );
    provenance = new URL(metadata.dist.attestations.url);
    assert.equal(provenance.origin, registry);
    assert(
      !provenance.username &&
        !provenance.password &&
        !provenance.hash &&
        !provenance.search,
    );
  }
  const url = new URL(metadata.dist.tarball);
  assert.equal(
    url.origin,
    destination,
    'npm tarball must come from the selected registry.',
  );
  assert(!url.username && !url.password && !url.hash && !url.search);
  const archive = await request(url.href, {
    maximum: pkg.bytes,
    headers,
    allowGitHubArtifactRedirect: destination === githubNpmRegistry,
  });
  assert.equal(archive.status, 200);
  assert.equal(archive.bytes.length, pkg.bytes);
  assert.equal(
    digest(archive.bytes, 'sha256'),
    pkg.sha256,
    'Public npm archive differs from the tested candidate.',
  );
  assert.equal(
    `sha512-${digest(archive.bytes, 'sha512', 'base64')}`,
    pkg.integrity,
  );
  await acceptArchive(archive.bytes);
  return {
    exists: true,
    tarball: url.href,
    provenance: provenance?.href ?? null,
    registry: destination,
    sha256: pkg.sha256,
    integrity: pkg.integrity,
  };
}

export async function loadNpmPublication(root, context, plan) {
  assert.equal(
    plan.policyApproved,
    true,
    'Source policy does not approve publishing.',
  );
  for (const key of [
    'repository',
    'commit',
    'ref',
    'version',
    'runId',
    'runAttempt',
  ])
    assert.equal(plan[key], context[key]);
  assert(['next', 'latest'].includes(plan.npm.tag));
  const directory = join(root, '.doctopus/release-assets/npm');
  await verifyReleaseAssets(directory, context, 'npm');
  const report = JSON.parse(
    await readRegularFile(join(directory, 'manifest.json')),
  );
  assert.equal(report.commit, context.commit);
  assert.equal(report.sourceWorkingTreeDirty, false);
  const metadata = (await readWorkspacePackages(root))
    .filter((pkg) => pkg.path && pkg.metadata.private !== true)
    .map((pkg) => pkg.metadata);
  const names = metadata.map((pkg) => pkg.name).sort();
  if (plan.npm.registry)
    assert(
      metadata.every(
        (pkg) => pkg.publishConfig?.registry === plan.npm.registry,
      ),
      'Package publishConfig must match the reviewed npm registry.',
    );
  assert.deepEqual([...plan.npm.packages].sort(), names);
  assert.deepEqual(report.packages.map((pkg) => pkg.name).sort(), names);
  for (const pkg of report.packages) {
    assert.equal(pkg.version, context.version);
    assert.equal(
      pkg.filename,
      `${pkg.name.replace(/^@/, '').replace('/', '-')}-${context.version}.tgz`,
    );
    const bytes = await readRegularFile(
      join(directory, pkg.filename),
      64 * 1024 * 1024,
    );
    assert.equal(bytes.length, pkg.bytes);
    assert.equal(digest(bytes, 'sha256'), pkg.sha256);
    assert.equal(`sha512-${digest(bytes, 'sha512', 'base64')}`, pkg.integrity);
  }
  return {
    directory,
    packages: npmPublicationOrder(metadata).map((name) =>
      report.packages.find((pkg) => pkg.name === name),
    ),
    tag: plan.npm.tag,
    registry: plan.npm.registry ?? registry,
  };
}

/** All immutable versions are preflighted before the first write; retries never overwrite. */
export async function publishNpmArchives(
  candidate,
  {
    request = releaseRequest,
    run = (file, args, options) => exec(file, args, options),
    env = process.env,
    receiptPath,
  } = {},
) {
  assert(['next', 'latest'].includes(candidate.tag));
  const destination = candidate.registry ?? registry;
  assert(destination === registry || destination === githubNpmRegistry);
  const states = [];
  for (const pkg of candidate.packages)
    states.push(
      await inspectNpmVersion(pkg, { request, registry: destination, env }),
    );
  const privateRoot = await mkdtemp(
    join(tmpdir(), 'doctopus-npm-publication-'),
  );
  const receipt = { schemaVersion: 1, complete: false, packages: [] };
  const retain = async () => {
    if (receiptPath)
      await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {
        mode: 0o600,
      });
  };
  try {
    const userconfig = join(privateRoot, 'npmrc');
    // npm expands this reference itself. A token value never enters a file or command argument.
    await writeFile(
      userconfig,
      destination === githubNpmRegistry
        ? '//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}\n'
        : env.NPM_TOKEN
          ? '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n'
          : '',
      { flag: 'wx', mode: 0o600 },
    );
    for (const [index, pkg] of candidate.packages.entries()) {
      if (!states[index].exists) {
        assert(
          destination === githubNpmRegistry
            ? env.GITHUB_PACKAGES_TOKEN
            : env.NPM_TOKEN ||
                (env.ACTIONS_ID_TOKEN_REQUEST_URL &&
                  env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
          'npm requires trusted publishing or a bootstrap token.',
        );
        try {
          await run(
            'npm',
            [
              'publish',
              join(candidate.directory, pkg.filename),
              '--ignore-scripts',
              '--access',
              'public',
              ...(destination === registry ? ['--provenance'] : []),
              '--tag',
              candidate.tag,
              '--registry',
              destination,
              '--userconfig',
              userconfig,
              '--cache',
              join(privateRoot, 'cache'),
            ],
            {
              cwd: privateRoot,
              env,
              timeout: 180_000,
              maxBuffer: 4 * 1024 * 1024,
            },
          );
        } catch {
          throw new Error(
            `npm publication failed for ${pkg.name}. Inspect retained receipts and public registry state before retrying; completed versions are immutable.`,
          );
        }
      }
      const result = await inspectNpmVersion(pkg, {
        request,
        registry: destination,
        env,
      });
      assert(
        result.exists,
        `Published npm version is not yet publicly available: ${pkg.name}. Retry verification; do not rebuild.`,
      );
      receipt.packages.push({
        name: pkg.name,
        version: pkg.version,
        reused: states[index].exists,
        ...result,
      });
      await retain();
    }
    receipt.complete = true;
    await retain();
    return receipt;
  } finally {
    await retain();
    await rm(privateRoot, { recursive: true, force: true });
  }
}

export async function writeNpmPublicationReceiptDirectory(root) {
  const directory = join(root, '.doctopus/publication');
  await mkdir(directory, { recursive: true });
  return join(directory, 'npm-result.json');
}
