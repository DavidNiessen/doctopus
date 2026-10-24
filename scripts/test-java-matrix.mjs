import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseSource } from '@davidniessen/doctopus-spec';
import { clearJavaResults, readJavaResults } from './lib/java-results.mjs';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
const java = join(repository, 'integrations/java');
assert(
  process.platform !== 'win32',
  'Use Linux, macOS or WSL for the local matrix runner.',
);
const workflow = parseSource(
  await readFile(join(repository, '.github/workflows/quality.yml'), 'utf8'),
  'quality.yml',
);
const matrix = workflow.jobs.java.strategy.matrix;
assert(
  Array.isArray(matrix.java) &&
    matrix.java.length > 0 &&
    matrix.java.length <= 8,
);
assert(
  Array.isArray(matrix.boot) &&
    matrix.boot.length > 0 &&
    matrix.boot.length <= 4,
);
const runtimes = matrix.java.map((feature) => {
  assert(
    /^\d+$/.test(feature) && Number(feature) >= 17,
    'Unsupported Java matrix entry',
  );
  const home = process.env[`JAVA${feature}_HOME`];
  assert(home, `Set JAVA${feature}_HOME to its installed JDK directory.`);
  return { feature: Number(feature), home: resolve(home) };
});
for (const boot of matrix.boot)
  assert(/^\d+\.\d+\.\d+$/.test(boot), 'Unsupported Boot matrix entry');
const args = JSON.parse(process.env.JAVA_MATRIX_MAVEN_ARGS ?? '[]');
assert(
  Array.isArray(args) &&
    args.length <= 32 &&
    args.every((arg) => typeof arg === 'string'),
);
const maven = process.env.JAVA_MATRIX_MAVEN ?? join(java, 'mvnw');
const commit = (
  await exec('git', ['rev-parse', 'HEAD'], { cwd: repository })
).stdout.trim();
const output = join(
  repository,
  '.doctopus/java-matrix',
  `${commit.slice(0, 12)}-${Date.now()}`,
);
await mkdir(output, { recursive: true });
await exec(
  process.execPath,
  [join(repository, 'scripts/prepare-java-fixture.mjs')],
  { cwd: repository, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
);
const manifest = JSON.parse(
  await readFile(
    join(repository, '.doctopus/java-fixture/.doctopus/site/manifest.json'),
    'utf8',
  ),
);
const report = {
  timestamp: new Date().toISOString(),
  commit,
  sourceWorkingTreeDirty:
    (
      await exec('git', ['status', '--porcelain'], { cwd: repository })
    ).stdout.trim().length > 0,
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  artifactDigest: manifest.artifactDigest,
  manifestVersion: manifest.schemaVersion,
  expectedCombinations: runtimes.length * matrix.boot.length,
  passed: false,
  entries: [],
};
const secretValues = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      /password|token|secret|credential|api_key/i.test(name) &&
      value?.length >= 4,
  )
  .map(([, value]) => value);
const safeLog = (text) => {
  let cleaned = text.replace(
    /^(?:NOTE: )?Picked up (?:JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS):.*$/gm,
    '[Java environment options omitted]',
  );
  for (const value of secretValues)
    cleaned = cleaned.split(value).join('[environment credential omitted]');
  return cleaned;
};

try {
  for (const runtime of runtimes) {
    const environment = {
      ...process.env,
      JAVA_HOME: runtime.home,
      PATH: join(runtime.home, 'bin') + delimiter + (process.env.PATH ?? ''),
    };
    const versionOutput = await exec(
      join(runtime.home, 'bin/java'),
      ['-version'],
      { env: environment },
    );
    const version = (versionOutput.stderr + versionOutput.stdout).match(
      /(?:openjdk|java) version "([^"]+)"/,
    )?.[1];
    assert(
      version && Number(version.split('.')[0]) === runtime.feature,
      `JAVA${runtime.feature}_HOME points to the wrong JDK`,
    );
    for (const boot of matrix.boot) {
      // Remove only generated reports so stale results cannot hide skipped execution.
      await clearJavaResults(java);
      console.log(`Running Java ${version} / Spring Boot ${boot}`);
      let result;
      try {
        result = await exec(
          maven,
          [
            ...args,
            '--batch-mode',
            '--no-transfer-progress',
            '--strict-checksums',
            `-Dspring-boot.version=${boot}`,
            'verify',
          ],
          {
            cwd: java,
            env: environment,
            timeout: 180_000,
            maxBuffer: 8 * 1024 * 1024,
          },
        );
      } catch (error) {
        await writeFile(
          join(output, `java-${runtime.feature}-boot-${boot}.log`),
          safeLog((error.stdout ?? '') + (error.stderr ?? '')),
        );
        report.entries.push({
          java: runtime.feature,
          version,
          boot,
          passed: false,
        });
        // Keep process status as the cause, without exposing raw command arguments or output.
        error.message =
          'Maven process failed; output is retained in the local matrix log.';
        error.stack = error.message;
        for (const field of ['stdout', 'stderr', 'cmd', 'spawnargs'])
          delete error[field];
        throw new Error(
          `Java ${runtime.feature} / Boot ${boot} failed; inspect its local matrix log.`,
          { cause: error },
        );
      }
      const suites = await readJavaResults(java);
      report.entries.push({
        java: runtime.feature,
        version,
        boot,
        passed: true,
        suites,
      });
      await writeFile(
        join(output, `java-${runtime.feature}-boot-${boot}.log`),
        safeLog(result.stdout + result.stderr),
      );
      console.log(
        `PASS Java ${runtime.feature} / Boot ${boot}: ${suites.reduce((sum, suite) => sum + suite.tests, 0)} tests, no skips`,
      );
    }
  }
  assert.equal(report.entries.length, runtimes.length * matrix.boot.length);
  report.passed = true;
  console.log(
    `Java matrix passed: ${report.entries.length} combinations. Report: ${join(output, 'report.json')}`,
  );
} finally {
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
