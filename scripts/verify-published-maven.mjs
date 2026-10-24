import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { releaseSource } from './lib/release-assets.mjs';
import { readRegularFile } from './lib/read-regular-file.mjs';
import {
  loadGitHubMavenPublication,
  inspectGitHubMaven,
  verifyGitHubMavenCache,
} from './lib/github-maven-publication.mjs';
import {
  githubMavenConfiguration,
  githubPackageRepository,
} from './lib/github-packages.mjs';
import { verifyProducerSubject } from './lib/provenance-verification.mjs';
import {
  javaEnvironment,
  prepareJavaPublications,
  saveJavaCandidate,
  testJavaConsumers,
} from './lib/java-consumers.mjs';

assert.equal(process.argv.length, 2);
const root = process.cwd();
const source = await releaseSource(root, process.env, {
  workflow: 'release-publish.yml',
});
const plan = JSON.parse(
  await readRegularFile(join(root, '.doctopus/publication/plan.json')),
);
const context = { ...source, runId: plan.runId, runAttempt: plan.runAttempt };
const accepted = await loadGitHubMavenPublication(root, context, plan);
const repositoryVisibility = await githubPackageRepository(context.repository);
const output = join(root, '.doctopus/published-consumers/maven');
await mkdir(output, { recursive: true });
const state = await inspectGitHubMaven(accepted, {
  acceptFile: async (file, bytes) => {
    const path = join(output, file.name);
    await writeFile(path, bytes, { flag: 'wx' });
    const proof = await verifyProducerSubject(path, context);
    await writeFile(
      path + '.provenance.json',
      JSON.stringify(proof, null, 2) + '\n',
      { flag: 'wx' },
    );
  },
});
assert(
  state.exists,
  'GitHub Maven propagation is incomplete. Retry verification without rebuilding.',
);
const config = await githubMavenConfiguration(context.repository);
try {
  const report = JSON.parse(
    await readRegularFile(join(accepted.directory, 'report.json')),
  );
  const candidate = {
    output,
    report: {
      ...report,
      consumers: [],
      passed: false,
      producerProvenanceVerified: true,
      signaturesVerified: true,
      signatureScheme: 'github-actions-producer-attestation',
      published: true,
      freshRegistryConsumer: true,
      registry: accepted.registry,
    },
    environment: javaEnvironment(process.env.JAVA_HOME),
    maven:
      process.env.JAVA_CONSUMER_MAVEN ?? join(root, 'integrations/java/mvnw'),
    args: config.args,
  };
  await prepareJavaPublications(candidate);
  await testJavaConsumers(candidate, { expectedJava: 21 });
  assert.equal(candidate.report.consumers.length, 2);
  assert(
    candidate.report.consumers.every(
      (entry) => entry.passed && entry.offlineCompilationPassed,
    ),
  );
  const installedOrigins = await verifyGitHubMavenCache(
    accepted.files,
    join(config.directory, 'empty-m2'),
  );
  candidate.report.passed = true;
  await saveJavaCandidate(candidate);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        ...context,
        passed: true,
        registry: accepted.registry,
        installedOrigins,
        repositoryVisibility,
        checks: [
          'github-registry-archive-hashes',
          'exact-producer-attestations',
          'fresh-authenticated-maven-repository',
          'github-origin-for-installed-project-files',
          'installed-mvc-and-webflux',
          'offline-consumer-compilation',
        ],
        files: accepted.files,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    'GitHub Maven bytes, producer provenance, fresh MVC/WebFlux consumers and offline compilation passed.',
  );
} finally {
  await rm(config.directory, { recursive: true, force: true });
}
