import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readWorkspacePackages } from './lib/workspaces.mjs';
import { auditReleaseVersions } from './lib/release-versions.mjs';

const exec = promisify(execFile);
export const repository = fileURLToPath(new URL('../', import.meta.url));
export async function packNpmCandidates() {
  const versions = await auditReleaseVersions(repository);
  const commit = (
    await exec('git', ['rev-parse', 'HEAD'], { cwd: repository })
  ).stdout.trim();
  const dirty =
    (
      await exec('git', ['status', '--porcelain'], { cwd: repository })
    ).stdout.trim().length > 0;
  const destination = join(
    repository,
    '.doctopus/npm-candidates',
    `${commit.slice(0, 12)}-${Date.now()}`,
  );
  await mkdir(destination, { recursive: true });
  const staging = await mkdtemp(join(tmpdir(), 'doctopus-npm-stage-'));
  const directories = (await readWorkspacePackages(repository))
    .filter((pkg) => pkg.path && pkg.metadata.private !== true)
    .map((pkg) => pkg.path);
  const packages = [];
  const filenames = new Set();
  try {
    for (const directory of directories) {
      const root = join(repository, directory);
      const metadata = JSON.parse(
        await readFile(join(root, 'package.json'), 'utf8'),
      );
      assert.notEqual(metadata.private, true, `${metadata.name} is private`);
      assert.equal(metadata.license, 'Apache-2.0');
      assert.equal(
        metadata.version,
        versions.version,
        'Package version changed during packing.',
      );
      const filename = `${metadata.name.replace(/^@/, '').replace('/', '-')}-${metadata.version}.tgz`;
      assert(!filenames.has(filename), 'Package archive filenames collide.');
      filenames.add(filename);
      const stage = await mkdtemp(join(staging, 'component-'));
      await cp(join(root, 'dist'), join(stage, 'dist'), {
        recursive: true,
        dereference: false,
      });
      // Only tracked source accompanies declaration/source maps. Never copy local .env files.
      const tracked = (
        await exec('git', ['ls-files', '-z', '--', `${directory}/src`], {
          cwd: repository,
        })
      ).stdout
        .split('\0')
        .filter(Boolean);
      for (const file of tracked) {
        const output = join(stage, relative(root, join(repository, file)));
        await mkdir(dirname(output), { recursive: true });
        await cp(join(repository, file), output);
      }
      for (const file of ['LICENSE', 'NOTICE'])
        await cp(join(repository, file), join(stage, file));
      await writeFile(
        join(stage, 'README.md'),
        `# ${metadata.name}\n\nSelf-hosted API documentation platform component, version ${metadata.version}.\n\nSee the [project documentation](https://github.com/DavidNiessen/doctopus#readme), [integration guide](https://github.com/DavidNiessen/doctopus/blob/master/docs/integrations.md) and [release and distribution instructions](https://github.com/DavidNiessen/doctopus/blob/master/docs/releases.md) for support status and verification.\n\nLicensed under Apache-2.0; see LICENSE and NOTICE.\n`,
      );
      const packageMetadata = { ...metadata };
      delete packageMetadata.scripts;
      delete packageMetadata.devDependencies;
      await writeFile(
        join(stage, 'package.json'),
        JSON.stringify(
          {
            ...packageMetadata,
            files: ['dist', 'src', 'LICENSE', 'NOTICE', 'README.md'],
            repository: {
              type: 'git',
              url: 'git+https://github.com/DavidNiessen/doctopus.git',
              directory,
            },
            bugs: { url: 'https://github.com/DavidNiessen/doctopus/issues' },
          },
          null,
          2,
        ),
      );
      const { stdout } = await exec(
        'npm',
        [
          'pack',
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          destination,
        ],
        { cwd: stage, maxBuffer: 8 * 1024 * 1024 },
      );
      const [packed] = JSON.parse(stdout);
      assert.equal(packed.name, metadata.name);
      assert.equal(packed.filename, filename);
      const files = new Set(packed.files.map((file) => file.path));
      for (const required of ['LICENSE', 'NOTICE', 'README.md', 'package.json'])
        assert(files.has(required), `${metadata.name}: missing ${required}`);
      const exports = (entry) =>
        typeof entry === 'string'
          ? [entry]
          : Object.values(entry).flatMap(exports);
      for (const path of exports(metadata.exports ?? {}))
        assert(
          files.has(path.replace(/^\.\//, '')),
          `${metadata.name}: missing export ${path}`,
        );
      for (const path of Object.values(metadata.bin ?? {}))
        assert(
          files.has(path.replace(/^\.\//, '')),
          `${metadata.name}: missing executable ${path}`,
        );
      assert(
        [...files].every(
          (file) =>
            !/(^|\/)\.env(?:\.|$)|(^|\/)\.git(?:\/|$)|(^|\/)node_modules\//.test(
              file,
            ),
        ),
        `${metadata.name}: forbidden package content`,
      );
      if (metadata.name === '@davidniessen/doctopus-reader')
        assert(
          files.has('dist/client/assets/reader.js') &&
            files.has('dist/client/assets/reader.css') &&
            files.has('dist/client/assets/oauth-callback.js') &&
            files.has('dist/client/assets/THIRD_PARTY_NOTICES.txt'),
          'Missing built reader assets',
        );
      const bytes = await readFile(join(destination, packed.filename));
      assert.equal(
        packed.integrity,
        `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      );
      packages.push({
        name: packed.name,
        version: packed.version,
        filename: packed.filename,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        integrity: packed.integrity,
        files: [...files].sort(),
      });
    }
    const manifest = {
      schemaVersion: 1,
      commit,
      sourceWorkingTreeDirty: dirty,
      packages,
    };
    await writeFile(
      join(destination, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    return { directory: destination, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log((await packNpmCandidates()).directory);
