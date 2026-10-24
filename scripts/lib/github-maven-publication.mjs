import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  githubPackageRegistries,
  githubPackageHeaders,
  githubMavenConfiguration,
} from './github-packages.mjs';
import { loadMavenPublication } from './maven-publication.mjs';
import { releaseRequest } from './release-http.mjs';
import { releaseCommand } from './release-command.mjs';
import { hashReleaseAsset } from './release-assets.mjs';
import { readRegularFile } from './read-regular-file.mjs';

/** Validate Maven's actual installed bytes and resolver-origin markers after fresh consumption. */
export async function verifyGitHubMavenCache(files, directory) {
  const origins = [];
  for (const file of files.filter(
    (file) =>
      file.name.endsWith('.pom') ||
      (file.name.endsWith('.jar') &&
        !file.name.endsWith('-sources.jar') &&
        !file.name.endsWith('-javadoc.jar')),
  )) {
    const path = join(directory, file.path);
    const actual = await hashReleaseAsset(path);
    assert.equal(
      actual.sha256,
      file.sha256,
      'Installed Maven consumer used different project bytes.',
    );
    assert.equal(actual.bytes, file.bytes);
    const markers = (
      await readRegularFile(join(dirname(path), '_remote.repositories'))
    ).toString('utf8');
    assert(
      markers.split('\n').includes(file.name + '>github='),
      'Project artifacts must resolve from GitHub Packages, not another repository or a local install.',
    );
    origins.push({
      name: file.name,
      sha256: file.sha256,
      repositoryId: 'github',
    });
  }
  return origins;
}

export async function loadGitHubMavenPublication(root, context, plan) {
  const registry = githubPackageRegistries(context.repository).maven;
  assert.equal(plan.maven.registry, registry);
  return {
    ...(await loadMavenPublication(root, context, plan, {
      requireSigning: false,
    })),
    registry,
    repository: context.repository,
  };
}

/** All existing files must match; only entirely absent artifact groups may be deployed. */
export async function inspectGitHubMaven(
  candidate,
  {
    request = releaseRequest,
    env = process.env,
    acceptFile = async () => {},
  } = {},
) {
  assert.equal(
    candidate.registry,
    githubPackageRegistries(candidate.repository).maven,
  );
  const headers = githubPackageHeaders('maven', env);
  const artifacts = [];
  for (const artifact of [
    'doctopus-parent',
    'doctopus-core',
    'doctopus-spring-boot-starter',
  ]) {
    const files = candidate.files.filter(
      (file) => file.path.split('/').at(-3) === artifact,
    );
    assert.equal(files.length, artifact === 'doctopus-parent' ? 1 : 4);
    let existing = 0;
    for (const file of files) {
      const result = await request(`${candidate.registry}/${file.path}`, {
        headers,
        maximum: Math.max(file.bytes, 64 * 1024),
        allowGitHubArtifactRedirect: true,
      });
      if (result.status === 404) continue;
      assert.equal(
        result.status,
        200,
        'Cannot inspect GitHub Maven publication.',
      );
      assert.equal(result.bytes.length, file.bytes);
      assert.equal(
        createHash('sha256').update(result.bytes).digest('hex'),
        file.sha256,
        'GitHub Maven bytes differ from the accepted candidate.',
      );
      await acceptFile(file, result.bytes);
      existing++;
    }
    assert(
      existing === 0 || existing === files.length,
      'A GitHub Maven artifact is partially visible. Inspect its receipt and wait for propagation; never overwrite it.',
    );
    artifacts.push({ artifact, files, exists: existing === files.length });
  }
  return { exists: artifacts.every((item) => item.exists), artifacts };
}

/** Deploy exact accepted POM/JAR/source/Javadoc files with the standard Maven protocol. */
export async function publishGitHubMaven(
  candidate,
  {
    root,
    request = releaseRequest,
    env = process.env,
    run = releaseCommand,
    receiptPath,
  } = {},
) {
  const state = await inspectGitHubMaven(candidate, { request, env });
  const config = await githubMavenConfiguration(candidate.repository, env);
  const receipt = {
    schemaVersion: 1,
    registry: candidate.registry,
    complete: false,
    artifacts: [],
  };
  const retain = async () => {
    if (receiptPath)
      await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {
        mode: 0o600,
      });
  };
  try {
    for (const item of state.artifacts) {
      if (!item.exists) {
        receipt.attemptedArtifact = item.artifact;
        await retain();
        const pom = item.files.find((file) => file.name.endsWith('.pom'));
        const binary = item.files.find(
          (file) =>
            file.name.endsWith('.jar') &&
            !file.name.endsWith('-sources.jar') &&
            !file.name.endsWith('-javadoc.jar'),
        );
        const coordinates = pom.path.split('/');
        const args = [
          ...config.args,
          '--batch-mode',
          '--no-transfer-progress',
          '--strict-checksums',
          'org.apache.maven.plugins:maven-deploy-plugin:3.1.4:deploy-file',
          '-DrepositoryId=github',
          '-Durl=' + candidate.registry,
          '-DgeneratePom=false',
          '-DgroupId=' + coordinates.slice(0, -3).join('.'),
          '-DartifactId=' + item.artifact,
          '-Dversion=' + coordinates.at(-2),
          '-Dpackaging=' + (binary ? 'jar' : 'pom'),
          '-DretryFailedDeploymentCount=1',
          '-DpomFile=' + join(candidate.directory, pom.name),
          '-Dfile=' + join(candidate.directory, (binary ?? pom).name),
        ];
        if (binary)
          for (const [classifier, option] of [
            ['sources', 'sources'],
            ['javadoc', 'javadoc'],
          ]) {
            const file = item.files.find((file) =>
              file.name.endsWith('-' + classifier + '.jar'),
            );
            assert(file);
            args.push(
              '-D' + option + '=' + join(candidate.directory, file.name),
            );
          }
        try {
          await run(join(root, 'integrations/java/mvnw'), args, {
            cwd: config.directory,
            env,
            timeout: 180_000,
            maxBuffer: 4 * 1024 * 1024,
          });
        } catch {
          throw new Error(
            'GitHub Maven deployment failed. Inspect the retained artifact receipt before retrying; published versions are immutable.',
          );
        }
      }
      const verified = await inspectGitHubMaven(candidate, { request, env });
      assert(
        verified.artifacts.find((entry) => entry.artifact === item.artifact)
          ?.exists,
        'GitHub Maven propagation is incomplete. Retry verification without rebuilding.',
      );
      receipt.artifacts.push({
        artifact: item.artifact,
        reused: item.exists,
        files: item.files,
      });
      await retain();
    }
    receipt.complete = true;
    await retain();
    return receipt;
  } finally {
    await retain();
    await rm(config.directory, { recursive: true, force: true });
  }
}
