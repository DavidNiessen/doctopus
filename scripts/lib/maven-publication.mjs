import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { releaseCommand } from './release-command.mjs';
import { readRegularFile } from './read-regular-file.mjs';
import { hashReleaseAsset, verifyReleaseAssets } from './release-assets.mjs';
import { releaseRequest } from './release-http.mjs';
import { githubPackageRegistries } from './github-packages.mjs';

const central = 'https://central.sonatype.com/api/v1/publisher';
export const mavenRegistry = 'https://repo.maven.apache.org/maven2';
const hash = (bytes, algorithm = 'sha256') =>
  createHash(algorithm).update(bytes).digest('hex');
const fingerprintPattern = /^(?:[A-F0-9]{40}|[A-F0-9]{64})$/;

export function mavenPublicationFiles(context, group) {
  assert.match(group, /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/);
  assert.match(context.version, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
  const files = [];
  for (const artifact of [
    'doctopus-parent',
    'doctopus-core',
    'doctopus-spring-boot-starter',
  ]) {
    const stem = `${artifact}-${context.version}`;
    for (const suffix of artifact === 'doctopus-parent'
      ? ['.pom']
      : ['.pom', '.jar', '-sources.jar', '-javadoc.jar']) {
      const name = stem + suffix;
      files.push({
        name,
        path: `${group.replaceAll('.', '/')}/${artifact}/${context.version}/${name}`,
      });
    }
  }
  return files;
}

export async function loadMavenPublication(
  root,
  context,
  plan,
  { requireSigning = true } = {},
) {
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
  if (requireSigning)
    assert.match(plan.maven.signingKeyFingerprint, fingerprintPattern);
  else
    assert.equal(
      plan.maven.registry,
      githubPackageRegistries(context.repository).maven,
    );
  const directory = join(root, '.doctopus/release-assets/java');
  const manifest = await verifyReleaseAssets(directory, context, 'java');
  const files = mavenPublicationFiles(context, plan.maven.groupId).map(
    (file) => {
      const entry = manifest.files.find((entry) => entry.name === file.name);
      assert(entry, `Accepted Maven file is missing: ${file.name}.`);
      return { ...file, bytes: entry.bytes, sha256: entry.sha256 };
    },
  );
  return { directory, files, fingerprint: plan.maven.signingKeyFingerprint };
}

/** Partial public coordinates are never overwritten or silently mixed with a new upload. */
export async function inspectMavenPublication(
  candidate,
  { request = releaseRequest } = {},
) {
  let existing = 0;
  for (const file of candidate.files) {
    const result = await request(`${mavenRegistry}/${file.path}`, {
      maximum: Math.max(file.bytes, 64 * 1024),
    });
    if (result.status === 404) continue;
    assert.equal(result.status, 200, `Cannot inspect Maven file ${file.name}.`);
    assert.equal(result.bytes.length, file.bytes);
    assert.equal(
      hash(result.bytes),
      file.sha256,
      'Existing Maven version differs from the tested candidate.',
    );
    existing++;
  }
  assert(
    existing === 0 || existing === candidate.files.length,
    'Maven publication is partially visible. Wait for Central propagation and retry; do not overwrite.',
  );
  return { exists: existing === candidate.files.length };
}

/** gpg receives key/passphrase only over stdin; process diagnostics never expose them. */
export async function runSigningTool(
  file,
  args,
  { cwd, env = process.env, input } = {},
) {
  try {
    return await releaseCommand(file, args, {
      cwd,
      env,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      input,
    });
  } catch {
    throw new Error(
      'Maven signing command failed. Check the configured key, fingerprint and passphrase.',
    );
  }
}

export function verifyGpgStatus(stdout, fingerprint) {
  assert.match(fingerprint, fingerprintPattern);
  assert(
    stdout.split('\n').some((line) => line.startsWith('[GNUPG:] GOODSIG ')),
    'Missing good detached signature status.',
  );
  assert(
    !stdout
      .split('\n')
      .some((line) =>
        /^\[GNUPG:\] (?:BADSIG|ERRSIG|EXPSIG|EXPKEYSIG|REVKEYSIG) /.test(line),
      ),
    'Expired, revoked or invalid Maven signature.',
  );
  const signatures = stdout
    .split('\n')
    .filter((line) => line.startsWith('[GNUPG:] VALIDSIG '));
  assert.equal(
    signatures.length,
    1,
    'Expected exactly one valid detached signature.',
  );
  const fields = signatures[0].split(' ');
  assert(
    fields[2] === fingerprint || fields.at(-1) === fingerprint,
    'Maven signature uses a different primary key.',
  );
}

/** Fail planning before any registry write if the reviewed public key is missing or mismatched. */
export async function inspectMavenPublicKey(key, fingerprint) {
  assert.match(fingerprint, fingerprintPattern);
  const text = key.toString('utf8');
  assert(
    text.startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----') &&
      !text.includes('-----BEGIN PGP PRIVATE KEY BLOCK-----'),
    'Commit only the reviewed armored public signing key.',
  );
  const home = await mkdtemp(join(tmpdir(), 'ad-pubkey-'));
  try {
    const result = await runSigningTool(
      'gpg',
      [
        '--homedir',
        home,
        '--batch',
        '--no-tty',
        '--with-colons',
        '--fingerprint',
        '--import-options',
        'show-only',
        '--dry-run',
        '--import',
      ],
      { input: key },
    );
    const lines = result.stdout.split('\n');
    assert.equal(
      lines.filter((line) => line.startsWith('pub:')).length,
      1,
      'Review exactly one primary Maven signing key.',
    );
    assert(
      !lines.some((line) => line.startsWith('sec:') || line.startsWith('ssb:')),
      'Private signing keys never belong in source.',
    );
    const primary =
      lines[lines.findIndex((line) => line.startsWith('pub:')) + 1];
    assert(primary?.startsWith('fpr:'));
    assert.equal(
      primary.split(':')[9],
      fingerprint,
      'Reviewed public key and publication policy disagree.',
    );
    return { fingerprint, publicKeySha256: hash(key) };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/** Exact existing archives are signed; Maven never rebuilds or rewrites a POM here. */
export async function signMavenBundle(
  candidate,
  destination,
  { env = process.env, run = runSigningTool } = {},
) {
  assert.match(candidate.fingerprint, fingerprintPattern);
  assert(
    env.MAVEN_SIGNING_KEY,
    'Configure the release environment signing key.',
  );
  const privateRoot = await mkdtemp(join(tmpdir(), 'ad-sign-'));
  const home = join(privateRoot, 'gnupg');
  await mkdir(home, { mode: 0o700 });
  await mkdir(destination, { recursive: true });
  const invoke = (args, input) =>
    run('gpg', ['--homedir', home, '--batch', '--no-tty', ...args], {
      cwd: destination,
      env,
      input,
    });
  try {
    await invoke(['--import'], env.MAVEN_SIGNING_KEY);
    const keys = await invoke([
      '--with-colons',
      '--fingerprint',
      '--list-secret-keys',
      candidate.fingerprint,
    ]);
    assert(
      keys.stdout
        .split('\n')
        .some(
          (line) =>
            line.startsWith('fpr:') &&
            line.split(':')[9] === candidate.fingerprint,
        ),
      'Configured key fingerprint is not present.',
    );
    const publicKey = await invoke([
      '--armor',
      '--export',
      candidate.fingerprint,
    ]);
    assert(publicKey.stdout.startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----'));
    await writeFile(
      join(destination, 'signing-public-key.asc'),
      publicKey.stdout,
      { flag: 'wx' },
    );
    const bundle = join(destination, 'bundle');
    await mkdir(bundle);
    const paths = [];
    for (const file of candidate.files) {
      const bytes = await readRegularFile(
        join(candidate.directory, file.name),
        64 * 1024 * 1024,
      );
      assert.equal(bytes.length, file.bytes);
      assert.equal(hash(bytes), file.sha256);
      const target = join(bundle, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
      await invoke(
        [
          '--pinentry-mode',
          'loopback',
          '--passphrase-fd',
          '0',
          '--local-user',
          candidate.fingerprint,
          '--armor',
          '--detach-sign',
          '--output',
          target + '.asc',
          target,
        ],
        env.MAVEN_SIGNING_PASSPHRASE ?? '',
      );
      const verification = await invoke([
        '--status-fd',
        '1',
        '--verify',
        target + '.asc',
        target,
      ]);
      verifyGpgStatus(verification.stdout, candidate.fingerprint);
      const signature = await readRegularFile(target + '.asc', 1024 * 1024);
      for (const [suffix, content] of [
        ['', bytes],
        ['.asc', signature],
      ]) {
        paths.push(file.path + suffix);
        for (const algorithm of ['md5', 'sha1', 'sha256', 'sha512']) {
          await writeFile(
            target + suffix + '.' + algorithm,
            hash(content, algorithm) + '\n',
            { flag: 'wx' },
          );
          paths.push(file.path + suffix + '.' + algorithm);
        }
      }
    }
    const archive = join(destination, 'central-bundle.zip');
    await run('zip', ['-q', '-X', archive, ...paths], { cwd: bundle, env });
    return {
      archive,
      publicKey: join(destination, 'signing-public-key.asc'),
      fingerprint: candidate.fingerprint,
      ...(await hashReleaseAsset(archive, 64 * 1024 * 1024)),
    };
  } finally {
    try {
      await run('gpgconf', ['--homedir', home, '--kill', 'gpg-agent'], { env });
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
    }
  }
}

/** Central USER_MANAGED validation must succeed before its explicit publish call. */
export async function publishCentralBundle(
  bundle,
  {
    version,
    token,
    receiptPath,
    request = releaseRequest,
    wait = setTimeout,
  } = {},
) {
  assert(
    typeof token === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(token),
    'Configure the base64 Maven Central user token.',
  );
  assert.match(version, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
  const receipt = {
    schemaVersion: 1,
    version,
    fingerprint: bundle.fingerprint,
    bundleSha256: bundle.sha256,
    complete: false,
    deploymentId: null,
    states: [],
  };
  const retain = () =>
    writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {
      mode: 0o600,
    });
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const bytes = await readRegularFile(bundle.archive, 64 * 1024 * 1024);
    assert.equal(hash(bytes), bundle.sha256);
    const form = new FormData();
    form.append(
      'bundle',
      new Blob([bytes], { type: 'application/zip' }),
      'central-bundle.zip',
    );
    const upload = await request(
      `${central}/upload?publishingType=USER_MANAGED&name=${encodeURIComponent('doctopus-' + version)}`,
      { method: 'POST', headers, body: form },
    );
    assert.equal(
      upload.status,
      201,
      'Maven Central upload failed. No credentials or raw response are retained.',
    );
    receipt.deploymentId = upload.bytes.toString('utf8').trim();
    assert.match(
      receipt.deploymentId,
      /^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/,
    );
    await retain();
    let publishRequested = false;
    for (let attempt = 0; attempt < 240; attempt++) {
      const result = await request(
        `${central}/status?id=${receipt.deploymentId}`,
        { method: 'POST', headers },
      );
      assert.equal(
        result.status,
        200,
        'Cannot inspect the retained Central deployment.',
      );
      const state = JSON.parse(result.bytes.toString('utf8'));
      assert.equal(state.deploymentId, receipt.deploymentId);
      assert(
        [
          'PENDING',
          'VALIDATING',
          'VALIDATED',
          'PUBLISHING',
          'PUBLISHED',
          'FAILED',
        ].includes(state.deploymentState),
        'Unknown Central deployment state.',
      );
      receipt.states.push(state.deploymentState);
      await retain();
      assert.notEqual(
        state.deploymentState,
        'FAILED',
        'Central rejected the deployment. Inspect its retained deployment ID in the Central portal.',
      );
      if (state.deploymentState === 'PUBLISHED') {
        receipt.complete = true;
        await retain();
        return receipt;
      }
      if (state.deploymentState === 'VALIDATED' && !publishRequested) {
        const publication = await request(
          `${central}/deployment/${receipt.deploymentId}`,
          { method: 'POST', headers },
        );
        assert.equal(
          publication.status,
          204,
          'Central publication request failed; inspect the retained deployment ID before retrying.',
        );
        publishRequested = true;
      }
      await wait(5_000);
    }
    throw new Error(
      'Central publication is still pending. Inspect the retained deployment ID; do not upload a duplicate bundle.',
    );
  } finally {
    await retain();
  }
}
