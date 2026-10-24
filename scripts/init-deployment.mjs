import { mkdir, writeFile, access, lstat, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
const directory = resolve(process.argv[2] ?? 'deploy/.secrets');
await mkdir(directory, { recursive: true, mode: 0o700 });
const info = await lstat(directory);
if (info.isSymbolicLink() || (info.mode & 0o077) !== 0)
  throw new Error(
    'Secret directory must be a real private directory with mode 0700',
  );
const names = [
  'db_password',
  'owner_password',
  'runtime_password',
  'database_url',
  'migration_url',
  'root_token',
];
for (const file of names) {
  try {
    await access(join(directory, file));
    throw new Error(
      `Refusing to overwrite ${file}. Use a new directory or perform a documented credential rotation.`,
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const password = randomBytes(32).toString('base64url');
const owner = randomBytes(32).toString('base64url');
const runtime = randomBytes(32).toString('base64url');
const values = {
  db_password: password,
  owner_password: owner,
  runtime_password: runtime,
  database_url: `postgresql://doctopus_runtime:${runtime}@db:5432/doctopus`,
  migration_url: `postgresql://doctopus_owner:${owner}@db:5432/doctopus`,
  root_token: randomBytes(48).toString('base64url'),
};
for (const [name, value] of Object.entries(values)) {
  await writeFile(join(directory, name), value + '\n', {
    flag: 'wx',
    mode: 0o444,
  });
  // The private parent directory protects these files on the host. Docker's
  // read-only secret bind mounts must also be readable by the non-root services.
  // Set the mode explicitly because a restrictive caller umask narrows writeFile.
  await chmod(join(directory, name), 0o444);
}
console.log(
  'Created private deployment directory and six secret files. Values were not printed. Mount them read-only into the appropriate services.',
);
