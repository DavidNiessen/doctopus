import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [action, target, acknowledgement, ...extra] = process.argv.slice(2);
if (
  !['backup', 'restore'].includes(action) ||
  !target ||
  (extra.length &&
    (extra.length !== 2 || extra[0] !== '--compose-override' || !extra[1]))
)
  throw new Error(
    'Usage: node scripts/recovery.mjs backup|restore DIRECTORY --writers-paused [--compose-override FILE]',
  );
if (acknowledgement !== '--writers-paused')
  throw new Error(
    'Pause artifact staging and publication writers before recovery operations; then pass --writers-paused. Readers may remain online during backup.',
  );
const project = process.env.COMPOSE_PROJECT_NAME;
if (!project || !/^[a-z0-9][a-z0-9_-]*$/.test(project))
  throw new Error(
    'Set COMPOSE_PROJECT_NAME explicitly to the source or fresh recovery deployment.',
  );
const compose = fileURLToPath(
  new URL('../deploy/compose.yaml', import.meta.url),
);
const override = fileURLToPath(
  new URL('../deploy/compose.restore.yaml', import.meta.url),
);
const configuredOverride = extra.length ? resolve(extra[1]) : undefined;
if (configuredOverride) {
  const info = await lstat(configuredOverride);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
    throw new Error(
      'Recovery Compose override must be a regular file no larger than 1 MiB.',
    );
}
const directory = resolve(target);
const files = ['database.dump', 'artifacts.tar'];

async function command(
  args,
  { input, output, writable = false, capture = false } = {},
) {
  const child = spawn(
    'docker',
    [
      'compose',
      '-p',
      project,
      '-f',
      compose,
      ...(configuredOverride ? ['-f', configuredOverride] : []),
      ...(writable ? ['-f', override] : []),
      ...args,
    ],
    {
      stdio: [
        input ? 'pipe' : 'ignore',
        output || capture ? 'pipe' : 'inherit',
        'inherit',
      ],
    },
  );
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Recovery command failed (exit ${code}). No existing deployment was erased.`,
            ),
          ),
    );
  });
  let captured = '';
  if (capture)
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      captured += chunk;
      if (captured.length > 65536) child.kill();
    });
  const transfers = [];
  if (input) transfers.push(pipeline(createReadStream(input), child.stdin));
  if (output)
    transfers.push(
      pipeline(
        child.stdout,
        createWriteStream(output, { flags: 'wx', mode: 0o600 }),
      ),
    );
  await Promise.all([completion, ...transfers]);
  return captured.trim();
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const run = (code) =>
  command(
    [
      'run',
      '--rm',
      '-T',
      '--no-deps',
      'docs',
      'node',
      '--input-type=module',
      '-e',
      code,
    ],
    { writable: true },
  );

if (action === 'backup') {
  await mkdir(directory, { mode: 0o700 });
  await writeFile(
    join(directory, '.incomplete'),
    'Recovery set is not complete.\n',
    { flag: 'wx', mode: 0o600 },
  );
  await command(
    [
      'exec',
      '-T',
      'db',
      'pg_dump',
      '--username=postgres',
      '--dbname=doctopus',
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--exclude-table-data=public.docs_sessions',
      '--exclude-table-data=public.docs_oidc',
    ],
    { output: join(directory, files[0]) },
  );
  await command(
    ['exec', '-T', 'docs', 'tar', '-cf', '-', '-C', '/data/artifacts', '.'],
    { output: join(directory, files[1]) },
  );
  const hashes = {};
  for (const name of files) hashes[name] = await digest(join(directory, name));
  await writeFile(
    join(directory, 'recovery.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        sourceProject: project,
        files: hashes,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  await unlink(join(directory, '.incomplete'));
  console.log(
    'Recovery set completed. Store it encrypted off-host and retain deployment secrets separately.',
  );
} else {
  // Recovery sets are privileged trusted content, just like deployable web artifacts.
  const metadata = JSON.parse(
    await readFile(join(directory, 'recovery.json'), 'utf8'),
  );
  if (metadata.schemaVersion !== 1)
    throw new Error('Unsupported recovery set version.');
  try {
    await lstat(join(directory, '.incomplete'));
    throw new Error('Refusing an incomplete recovery set.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of files) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (await digest(path)) !== metadata.files?.[name]
    )
      throw new Error(`Recovery integrity check failed: ${name}`);
  }
  await command(['up', '-d', '--wait', 'db']);
  const tables = await command(
    [
      'exec',
      '-T',
      'db',
      'psql',
      '--username=postgres',
      '--dbname=doctopus',
      '-Atc',
      "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
    ],
    { capture: true },
  );
  if (tables !== '0')
    throw new Error(
      'Restore requires a fresh database with no public tables. Refusing to overwrite it.',
    );
  await run(
    "import {readdir} from 'node:fs/promises'; if ((await readdir('/data/artifacts')).length) throw new Error('Restore requires an empty artifact volume');",
  );
  await command(
    [
      'run',
      '--rm',
      '-T',
      '--no-deps',
      'docs',
      'tar',
      '-xf',
      '-',
      '-C',
      '/data/artifacts',
      '-o',
      '--no-same-permissions',
      '-k',
    ],
    { input: join(directory, files[1]), writable: true },
  );
  // A rollback image can predate the current npm scope. Load its own verifier
  // through the stable package path shipped in both image generations.
  await run(
    "import {readdir,lstat} from 'node:fs/promises'; import {join} from 'node:path'; import {verifyArtifact} from '/app/packages/compiler/dist/index.js'; async function walk(path) { for (const entry of await readdir(path)) { const p=join(path,entry); const s=await lstat(p); if(s.isSymbolicLink() || (!s.isFile() && !s.isDirectory())) throw new Error('Unsafe recovery entry'); if(s.isDirectory()) await walk(p); }} await walk('/data/artifacts'); for (const name of await readdir('/data/artifacts')) { if(!/^[a-f0-9]{64}$/.test(name)) throw new Error('Unexpected artifact directory'); const manifest=await verifyArtifact(join('/data/artifacts',name)); if(manifest.artifactDigest!==name) throw new Error('Artifact identity mismatch'); }",
  );
  await command(
    [
      'exec',
      '-T',
      'db',
      'pg_restore',
      '--username=postgres',
      '--dbname=doctopus',
      '--role=doctopus_owner',
      '--no-owner',
      '--no-acl',
      '--single-transaction',
      '--exit-on-error',
    ],
    { input: join(directory, files[0]) },
  );
  await command(['run', '--rm', '-T', '--no-deps', 'migrate']);
  console.log(
    'Restored and verified into the fresh deployment. Run compose up, verify permissions and public/private routes, then direct traffic to it. Browser sessions were deliberately not restored.',
  );
}
