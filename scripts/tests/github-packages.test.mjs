import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  readFile,
  stat,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  githubPackageRegistries,
  githubPackageHeaders,
  validateGitHubNpmVisibility,
  githubPackageRepository,
  githubNpmVisibility,
} from '../lib/github-packages.mjs';
import {
  inspectGitHubMaven,
  publishGitHubMaven,
  verifyGitHubMavenCache,
} from '../lib/github-maven-publication.mjs';
import { mavenPublicationFiles } from '../lib/maven-publication.mjs';
import {
  inspectNpmVersion,
  publishNpmArchives,
} from '../lib/npm-publication.mjs';

const env = {
  GITHUB_ACTOR: 'release-automation[bot]',
  GITHUB_PACKAGES_TOKEN: 'unit-test-only-token',
};

test('an authenticated install cannot claim an open source package while it remains private or disconnected', () => {
  const metadata = {
    name: 'doctopus-contracts',
    package_type: 'npm',
    visibility: 'public',
    repository: { full_name: 'DavidNiessen/doctopus' },
  };
  assert.equal(
    validateGitHubNpmVisibility(
      metadata,
      '@davidniessen/doctopus-contracts',
      'DavidNiessen/doctopus',
    ).visibility,
    'public',
  );
  assert.throws(
    () =>
      validateGitHubNpmVisibility(
        { ...metadata, visibility: 'private' },
        '@davidniessen/doctopus-contracts',
        'DavidNiessen/doctopus',
      ),
    /visibility to Public/,
  );
  assert.throws(
    () =>
      validateGitHubNpmVisibility(
        { ...metadata, repository: { full_name: 'another/repository' } },
        '@davidniessen/doctopus-contracts',
        'DavidNiessen/doctopus',
      ),
    /source repository/,
  );
  assert.throws(() =>
    validateGitHubNpmVisibility(
      { ...metadata, name: 'another-package' },
      '@davidniessen/doctopus-contracts',
      'DavidNiessen/doctopus',
    ),
  );
});
const registries = githubPackageRegistries('DavidNiessen/doctopus');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const response = (bytes, status = 200) => ({
  status,
  bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(JSON.stringify(bytes)),
});

test('package visibility follows verified user or organization ownership and rejects private distribution repositories', async () => {
  for (const type of ['User', 'Organization']) {
    const calls = [];
    const run = async (_command, args) => {
      const endpoint = args.at(-1);
      calls.push(endpoint);
      return {
        stdout: JSON.stringify(
          endpoint.startsWith('repos/')
            ? {
                full_name: 'DavidNiessen/doctopus',
                private: false,
                owner: { type, login: 'DavidNiessen' },
              }
            : {
                name: 'doctopus-contracts',
                package_type: 'npm',
                visibility: 'public',
                repository: { full_name: 'DavidNiessen/doctopus' },
              },
        ),
      };
    };
    await githubNpmVisibility(
      '@davidniessen/doctopus-contracts',
      'DavidNiessen/doctopus',
      { run },
    );
    assert.equal(
      calls[1],
      (type === 'User' ? 'users' : 'orgs') +
        '/DavidNiessen/packages/npm/doctopus-contracts',
    );
  }
  await assert.rejects(
    githubPackageRepository('DavidNiessen/doctopus', {
      run: async () => ({
        stdout: JSON.stringify({
          full_name: 'DavidNiessen/doctopus',
          private: true,
        }),
      }),
    }),
    /public source repository/,
  );
});

test('GitHub registry coordinates and credentials reject foreign repositories and header injection', () => {
  assert.deepEqual(registries, {
    scope: '@davidniessen',
    npm: 'https://npm.pkg.github.com',
    maven: 'https://maven.pkg.github.com/davidniessen/doctopus',
  });
  for (const repository of [
    '../other',
    'owner/../other',
    'https://github.com/owner/repo',
    'owner/repo?token=x',
  ])
    assert.throws(() => githubPackageRegistries(repository));
  assert.equal(
    githubPackageHeaders('npm', env).Authorization,
    'Bearer ' + env.GITHUB_PACKAGES_TOKEN,
  );
  assert.equal(
    githubPackageHeaders('maven', env).Authorization,
    'Basic ' +
      Buffer.from(env.GITHUB_ACTOR + ':' + env.GITHUB_PACKAGES_TOKEN).toString(
        'base64',
      ),
  );
  assert.throws(() => githubPackageHeaders('npm', {}));
  const malformed = 'fixture-private-token\r\ninvalid-header';
  assert.throws(
    () => githubPackageHeaders('npm', { GITHUB_PACKAGES_TOKEN: malformed }),
    (error) =>
      error.actual === false && !error.stack.includes('fixture-private-token'),
  );
  assert.throws(() =>
    githubPackageHeaders('npm', { GITHUB_PACKAGES_TOKEN: 'bad\r\nheader' }),
  );
  assert.throws(() =>
    githubPackageHeaders('maven', { ...env, GITHUB_ACTOR: 'bad:user' }),
  );
});

const archive = Buffer.from('accepted GitHub npm archive fixture');
const pkg = {
  name: '@davidniessen/doctopus-contracts',
  version: '0.2.0',
  filename: 'davidniessen-contracts-0.2.0.tgz',
  bytes: archive.length,
  sha256: digest(archive),
  integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64'),
};
const tarball =
  registries.npm + '/download/@davidniessen/doctopus-contracts/0.2.0/archive';
const metadata = () => ({
  name: pkg.name,
  version: pkg.version,
  dist: { integrity: pkg.integrity, tarball },
});
const packument = (value = metadata()) => ({
  name: pkg.name,
  versions: { [pkg.version]: value },
});

test('GitHub npm downloads use scoped authentication and verify bytes before provenance callbacks', async () => {
  let verified = false;
  const request = async (url, options) => {
    assert.equal(new URL(url).origin, registries.npm);
    assert.deepEqual(options.headers, githubPackageHeaders('npm', env));
    return response(url === tarball ? archive : packument());
  };
  const result = await inspectNpmVersion(pkg, {
    registry: registries.npm,
    env,
    request,
    acceptArchive: async (bytes) => {
      assert.deepEqual(bytes, archive);
      verified = true;
    },
  });
  assert.equal(verified, true);
  assert.equal(
    (
      await inspectNpmVersion(pkg, {
        registry: registries.npm,
        env,
        request: async () => response({ name: pkg.name, versions: {} }),
      })
    ).exists,
    false,
  );
  await assert.rejects(
    inspectNpmVersion(pkg, {
      registry: registries.npm,
      env,
      request: async () => response({ name: pkg.name }),
    }),
    /Malformed/,
  );
  assert.equal(
    result.provenance,
    null,
    'GitHub producer attestations are verified separately; native npm provenance is not claimed.',
  );
  await assert.rejects(
    inspectNpmVersion(pkg, {
      registry: registries.npm,
      env,
      request: async () =>
        response(
          packument({
            ...metadata(),
            dist: {
              ...metadata().dist,
              tarball: 'https://registry.npmjs.org/leak',
            },
          }),
        ),
    }),
    /selected registry/,
  );
  await assert.rejects(
    inspectNpmVersion(pkg, {
      registry: registries.npm,
      env,
      request: async () => response({}, 401),
    }),
    /Cannot inspect/,
  );
});

test('GitHub npm publishing keeps tokens out of files and arguments and skips unsupported native npm signing', async () => {
  let published = false,
    settings;
  const result = await publishNpmArchives(
    {
      directory: '/accepted',
      packages: [pkg],
      tag: 'next',
      registry: registries.npm,
    },
    {
      env,
      request: async (url) =>
        response(
          url === tarball ? archive : packument(),
          published ? 200 : 404,
        ),
      run: async (command, args) => {
        assert.equal(command, 'npm');
        assert(!args.includes('--provenance'));
        assert(!args.join(' ').includes(env.GITHUB_PACKAGES_TOKEN));
        assert.equal(args[args.indexOf('--registry') + 1], registries.npm);
        settings = args[args.indexOf('--userconfig') + 1];
        assert.equal(
          await readFile(settings, 'utf8'),
          '//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}\n',
        );
        assert.equal((await stat(settings)).mode & 0o777, 0o600);
        assert.equal((await stat(dirname(settings))).mode & 0o777, 0o700);
        published = true;
      },
    },
  );
  assert.equal(result.complete, true);
  await assert.rejects(access(settings));
});

function mavenFixture() {
  const bytes = new Map();
  const files = mavenPublicationFiles({ version: '0.2.0' }, 'dev.niessen').map(
    (file) => {
      const data = Buffer.from(file.name);
      bytes.set(file.path, data);
      return { ...file, bytes: data.length, sha256: digest(data) };
    },
  );
  return {
    candidate: {
      directory: '/accepted',
      repository: 'DavidNiessen/doctopus',
      registry: registries.maven,
      files,
    },
    bytes,
  };
}

test('fresh Maven cache validation rejects different bytes and non-GitHub origin markers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ad-gh-maven-cache-'));
  const { candidate, bytes } = mavenFixture();
  try {
    for (const file of candidate.files) {
      const path = join(directory, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes.get(file.path));
      const marker = join(dirname(path), '_remote.repositories');
      await writeFile(marker, file.name + '>github=\n', { flag: 'a' });
    }
    assert.equal(
      (await verifyGitHubMavenCache(candidate.files, directory)).length,
      5,
    );
    const file = candidate.files.find((item) => item.name.endsWith('.jar'));
    await writeFile(join(directory, file.path), 'different bytes');
    await assert.rejects(
      verifyGitHubMavenCache(candidate.files, directory),
      /different project bytes/,
    );
    await writeFile(join(directory, file.path), bytes.get(file.path));
    const marker = join(directory, dirname(file.path), '_remote.repositories');
    await writeFile(
      marker,
      (await readFile(marker, 'utf8')).replaceAll('>github=', '>central='),
    );
    await assert.rejects(
      verifyGitHubMavenCache(candidate.files, directory),
      /must resolve from GitHub/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('GitHub Maven resumes complete artifact groups using exact accepted files and private environment-reference settings', async () => {
  const { candidate, bytes } = mavenFixture();
  const remote = new Map(
    [...bytes].filter(([path]) => path.includes('/doctopus-parent/')),
  );
  let commands = 0,
    settings;
  const request = async (url, options) => {
    assert.deepEqual(options.headers, githubPackageHeaders('maven', env));
    const path = url.slice(registries.maven.length + 1);
    return response(
      remote.get(path) ?? Buffer.from('not found'),
      remote.has(path) ? 200 : 404,
    );
  };
  const receipt = await publishGitHubMaven(candidate, {
    root: '/source',
    env,
    request,
    run: async (command, args) => {
      commands++;
      assert.equal(command, '/source/integrations/java/mvnw');
      assert(
        args.includes(
          'org.apache.maven.plugins:maven-deploy-plugin:3.1.4:deploy-file',
        ),
      );
      assert(args.includes('-DgeneratePom=false'));
      assert(!args.join(' ').includes(env.GITHUB_PACKAGES_TOKEN));
      settings = args[args.indexOf('--settings') + 1];
      const content = await readFile(settings, 'utf8');
      assert(content.includes('${env.GITHUB_PACKAGES_TOKEN}'));
      assert(!content.includes(env.GITHUB_PACKAGES_TOKEN));
      assert.equal((await stat(settings)).mode & 0o777, 0o600);
      const binary = args.find((arg) => arg.startsWith('-Dfile=')).slice(7);
      const artifact = binary.includes('spring-boot-starter')
        ? 'doctopus-spring-boot-starter'
        : 'doctopus-core';
      for (const [path, data] of bytes)
        if (path.includes('/' + artifact + '/')) remote.set(path, data);
    },
  });
  assert.equal(commands, 2);
  assert.equal(receipt.complete, true);
  assert.equal(receipt.artifacts[0].reused, true);
  await assert.rejects(access(settings));
});

test('conflicting or partially visible GitHub Maven groups fail before any deployment', async () => {
  const { candidate, bytes } = mavenFixture();
  await assert.rejects(
    inspectGitHubMaven(candidate, {
      env,
      request: async () => response(Buffer.from('wrong')),
    }),
  );
  const first = candidate.files.find((file) =>
    file.name.startsWith('doctopus-core'),
  );
  let writes = 0;
  await assert.rejects(
    publishGitHubMaven(candidate, {
      root: '/source',
      env,
      request: async (url) =>
        response(
          url.endsWith(first.path) ? bytes.get(first.path) : Buffer.alloc(0),
          url.endsWith(first.path) ? 200 : 404,
        ),
      run: async () => {
        writes++;
      },
    }),
    /partially visible/,
  );
  assert.equal(writes, 0);
  await assert.rejects(
    inspectGitHubMaven(
      { ...candidate, registry: 'https://maven.pkg.github.com/another/repo' },
      { env },
    ),
  );
});

test('failed GitHub Maven commands redact credentials and remove their private settings', async () => {
  const { candidate } = mavenFixture();
  let settings;
  await assert.rejects(
    publishGitHubMaven(candidate, {
      root: '/source',
      env,
      request: async () => response(Buffer.alloc(0), 404),
      run: async (_command, args) => {
        settings = args[args.indexOf('--settings') + 1];
        throw new Error(env.GITHUB_PACKAGES_TOKEN);
      },
    }),
    (error) =>
      error.message.includes('GitHub Maven deployment failed') &&
      !error.stack.includes(env.GITHUB_PACKAGES_TOKEN),
  );
  await assert.rejects(access(settings));
});
