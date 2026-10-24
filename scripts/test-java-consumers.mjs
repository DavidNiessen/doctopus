import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSource } from '@davidniessen/doctopus-spec';
import {
  buildJavaCandidate,
  javaEnvironment,
  mavenArguments,
  repository,
  saveJavaCandidate,
  testJavaConsumers,
} from './lib/java-consumers.mjs';

const args = process.argv.slice(2);
let matrix = false,
  selectedBoot;
while (args.length) {
  const option = args.shift();
  if (option === '--matrix') {
    assert(!matrix, 'Duplicate --matrix.');
    matrix = true;
  } else if (option === '--boot') {
    assert(!selectedBoot && args.length, '--boot requires one version.');
    selectedBoot = args.shift();
  } else
    throw new Error('Use test-java-consumers.mjs [--boot VERSION | --matrix].');
}
assert(!(matrix && selectedBoot), 'Use either --matrix or --boot.');
const workflow = parseSource(
  await readFile(join(repository, '.github/workflows/quality.yml'), 'utf8'),
  'quality.yml',
);
const supported = workflow.jobs.java.strategy.matrix;
assert(
  Array.isArray(supported.java) &&
    supported.java.length > 0 &&
    supported.java.length <= 8 &&
    supported.java.every((value) => /^\d+$/.test(value) && Number(value) >= 17),
);
assert(
  Array.isArray(supported.boot) &&
    supported.boot.length > 0 &&
    supported.boot.length <= 4 &&
    supported.boot.every((value) => /^\d+\.\d+\.\d+$/.test(value)),
);
assert(
  !selectedBoot || supported.boot.includes(selectedBoot),
  'Select a supported Spring Boot version from the quality matrix.',
);
const runtimes = matrix
  ? supported.java.map((version) => ({
      environment: javaEnvironment(process.env[`JAVA${version}_HOME`]),
      feature: Number(version),
    }))
  : [{ environment: javaEnvironment(process.env.JAVA_HOME) }];
const boots = matrix ? supported.boot : [selectedBoot ?? supported.boot[0]];
const maven = process.env.JAVA_CONSUMER_MAVEN ?? process.env.JAVA_MATRIX_MAVEN;
const mavenArgs = mavenArguments(
  process.env.JAVA_CONSUMER_MAVEN_ARGS ?? process.env.JAVA_MATRIX_MAVEN_ARGS,
);
const candidate = await buildJavaCandidate({
  environment: runtimes[0].environment,
  ...(maven ? { maven } : {}),
  args: mavenArgs,
  baselineBoot: supported.boot[0],
});
candidate.report.expectedConsumers = runtimes.length * boots.length * 2;
try {
  for (const runtime of runtimes)
    for (const boot of boots)
      await testJavaConsumers(candidate, {
        environment: runtime.environment,
        boot,
        expectedJava: runtime.feature,
      });
  assert.equal(
    candidate.report.consumers.length,
    candidate.report.expectedConsumers,
  );
  candidate.report.passed = candidate.report.consumers.every(
    (entry) => entry.passed,
  );
  assert(candidate.report.passed, 'Every installed Java consumer must pass.');
  console.log(
    `Installed Java consumer validation passed: ${candidate.report.consumers.length} consumers. Report: ${join(candidate.output, 'report.json')}`,
  );
} finally {
  await saveJavaCandidate(candidate);
}
