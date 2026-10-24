import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildSite } from '@davidniessen/doctopus-cli';
import { parseSource } from '@davidniessen/doctopus-spec';
import { auditReleaseVersions } from './release-versions.mjs';
import { bindJavaSbom, validateSpringMetadata } from './java-distributions.mjs';

const exec = promisify(execFile);
export const repository = fileURLToPath(new URL('../../', import.meta.url));
const fixture = join(repository, 'scripts/fixtures/java-consumer');
const javaRoot = join(repository, 'integrations/java');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const versionPattern = /^\d+\.\d+\.\d+$/;

export function javaEnvironment(home, inherited = process.env) {
  assert(home, 'Set JAVA_HOME or the selected JAVA17/21/25_HOME.');
  return {
    ...inherited,
    JAVA_HOME: resolve(home),
    PATH: join(resolve(home), 'bin') + delimiter + (inherited.PATH ?? ''),
  };
}
export function mavenArguments(value = '[]') {
  const args = JSON.parse(value);
  assert(
    Array.isArray(args) &&
      args.length <= 32 &&
      args.every((value) => typeof value === 'string'),
    'Maven arguments must be a JSON array of at most 32 strings.',
  );
  return args;
}
export function sanitizeJavaLog(value, environment, args) {
  let text = value.replace(
    /^(?:NOTE: )?Picked up (?:JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS):.*$/gm,
    '[Java environment options omitted]',
  );
  const sensitive = /password|token|secret|credential|api_key/i;
  const values = Object.entries(environment)
    .filter(([name, value]) => sensitive.test(name) && value?.length >= 4)
    .map(([, value]) => value);
  for (const argument of args) {
    const match = argument.match(/^-D([^=]+)=(.*)$/);
    if (match && sensitive.test(match[1]) && match[2].length >= 4)
      values.push(match[2]);
  }
  for (const secret of values)
    text = text.split(secret).join('[environment credential omitted]');
  return text;
}
async function run(
  command,
  args,
  { cwd, environment, log, timeout = 180_000 },
) {
  try {
    const result = await exec(command, args, {
      cwd,
      env: environment,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (log)
      await writeFile(
        log,
        sanitizeJavaLog(result.stdout + result.stderr, environment, args),
      );
    return result;
  } catch (error) {
    if (log)
      await writeFile(
        log,
        sanitizeJavaLog(
          (error.stdout ?? '') + (error.stderr ?? ''),
          environment,
          args,
        ),
      );
    // Child-process errors include raw arguments/output; preserve only a safe cause.
    error.message = 'Java validation process failed.';
    error.stack = error.message;
    for (const field of ['stdout', 'stderr', 'cmd', 'spawnargs', 'spawnfile'])
      delete error[field];
    throw new Error(
      `Java validation command failed${log ? '; inspect the retained validation log' : ''}.`,
      { cause: error },
    );
  }
}
async function runtimeVersion(environment) {
  const result = await run(
    join(environment.JAVA_HOME, 'bin/java'),
    ['-version'],
    { environment },
  );
  const version = (result.stdout + result.stderr).match(
    /(?:openjdk|java) version "([^"]+)"/,
  )?.[1];
  assert(
    version && Number(version.split('.')[0]) >= 17,
    'Java 17 or newer is required.',
  );
  return version;
}

/** Build/install once at the baseline Boot version; every consumer must load these exact bytes. */
export async function buildJavaCandidate({
  environment,
  maven = join(javaRoot, 'mvnw'),
  args = [],
  baselineBoot = '3.5.16',
}) {
  assert(
    process.platform !== 'win32',
    'Use Linux, macOS or WSL for installed Java consumer checks.',
  );
  assert(
    versionPattern.test(baselineBoot),
    'Invalid baseline Spring Boot version.',
  );
  const versions = await auditReleaseVersions(repository);
  const commit = (
    await exec('git', ['rev-parse', 'HEAD'], { cwd: repository })
  ).stdout.trim();
  const dirty =
    (
      await exec('git', ['status', '--porcelain'], { cwd: repository })
    ).stdout.trim().length > 0;
  const output = join(
    repository,
    '.doctopus/java-candidates',
    `${commit.slice(0, 12)}-${Date.now()}`,
  );
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    commit,
    sourceWorkingTreeDirty: dirty,
    version: versions.javaVersion,
    buildJava: await runtimeVersion(environment),
    targetJava: 17,
    baselineBoot,
    namespaceOwnershipVerified: false,
    signaturesVerified: false,
    published: false,
    passed: false,
    artifacts: [],
    distributions: [],
    consumers: [],
  };
  const candidate = { output, report, environment, maven, args };
  try {
    await run(
      maven,
      [
        ...args,
        '--batch-mode',
        '--no-transfer-progress',
        '--strict-checksums',
        `-Dspring-boot.version=${baselineBoot}`,
        '-DskipTests',
        'clean',
        'install',
      ],
      { cwd: javaRoot, environment, log: join(output, 'candidate-build.log') },
    );
    await cp(
      join(javaRoot, 'pom.xml'),
      join(output, `doctopus-parent-${versions.javaVersion}.pom`),
    );
    report.parentPom = {
      filename: `doctopus-parent-${versions.javaVersion}.pom`,
      sha256: sha(await readFile(join(javaRoot, 'pom.xml'))),
    };
    const license = sha(await readFile(join(repository, 'LICENSE'))),
      notice = sha(await readFile(join(repository, 'NOTICE')));
    for (const module of ['core', 'spring-boot-starter']) {
      const artifact = `doctopus-${module}`,
        name = `${artifact}-${versions.javaVersion}`;
      await cp(
        join(javaRoot, module, `target/${name}.jar`),
        join(output, name + '.jar'),
      );
      await cp(join(javaRoot, module, 'pom.xml'), join(output, name + '.pom'));
      const result = await run(
        join(environment.JAVA_HOME, 'bin/java'),
        [
          join(fixture, 'InspectJar.java'),
          join(output, name + '.jar'),
          module,
          versions.javaVersion,
          license,
          notice,
        ],
        {
          environment,
          timeout: 30_000,
          log: join(output, `inspect-${module}.log`),
        },
      );
      const { configurationMetadataBase64, ...inspection } = JSON.parse(
          result.stdout,
        ),
        pomSha256 = sha(await readFile(join(output, name + '.pom')));
      if (module === 'spring-boot-starter') {
        assert(
          typeof configurationMetadataBase64 === 'string',
          'Missing Spring configuration metadata.',
        );
        report.springConfiguration = validateSpringMetadata(
          JSON.parse(
            Buffer.from(configurationMetadataBase64, 'base64').toString('utf8'),
          ),
        );
      }
      assert.equal(
        inspection.pomSha256,
        pomSha256,
        'Embedded and distributed Maven POMs disagree.',
      );
      report.artifacts.push({
        module,
        artifact,
        filename: name + '.jar',
        sha256: sha(await readFile(join(output, name + '.jar'))),
        pomSha256,
        ...inspection,
      });
      for (const classifier of ['sources', 'javadoc']) {
        const filename = `${name}-${classifier}.jar`;
        await cp(
          join(javaRoot, module, 'target', filename),
          join(output, filename),
        );
        const documentation = await run(
          join(environment.JAVA_HOME, 'bin/java'),
          [
            join(fixture, 'InspectDocumentation.java'),
            join(output, filename),
            module,
            classifier,
            versions.javaVersion,
            license,
            notice,
          ],
          {
            environment,
            timeout: 30_000,
            log: join(output, `inspect-${module}-${classifier}.log`),
          },
        );
        const inspected = JSON.parse(documentation.stdout);
        if (classifier === 'sources')
          assert.equal(
            inspected.pomSha256,
            pomSha256,
            'Source archive Maven metadata disagrees.',
          );
        report.distributions.push({
          module,
          artifact,
          classifier,
          filename,
          sha256: sha(await readFile(join(output, filename))),
          ...inspected,
        });
      }
    }
    await run(
      maven,
      [
        ...args,
        '--batch-mode',
        '--no-transfer-progress',
        '--strict-checksums',
        `-Dspring-boot.version=${baselineBoot}`,
        '-DskipTests',
        'org.cyclonedx:cyclonedx-maven-plugin:makeAggregateBom',
      ],
      { cwd: javaRoot, environment, log: join(output, 'sbom-build.log') },
    );
    const rawBom = await readFile(join(javaRoot, 'target/bom.json'));
    assert(rawBom.byteLength <= 4 * 1024 * 1024, 'Oversized Java SBOM.');
    const bom = bindJavaSbom(JSON.parse(rawBom.toString('utf8')), {
      version: versions.javaVersion,
      artifacts: report.artifacts,
      parentPom: report.parentPom,
    });
    const bomBytes = JSON.stringify(bom, null, 2) + '\n';
    await writeFile(join(output, 'java-bom.cdx.json'), bomBytes);
    report.javaSbom = {
      filename: 'java-bom.cdx.json',
      sha256: sha(bomBytes),
      components: bom.components.length,
      dependencies: bom.dependencies.length,
      scopes: ['compile', 'provided', 'runtime'],
      testScopeExcluded: true,
    };
    await prepareJavaPublications(candidate);
    await saveJavaCandidate(candidate);
    return candidate;
  } catch (error) {
    report.failure =
      'Candidate build or inspection failed; inspect its retained logs.';
    await saveJavaCandidate(candidate);
    throw error;
  }
}
/** Build only documentation fixtures; public registry consumers must never install project JARs. */
export async function prepareJavaPublications(candidate) {
  const publications = [
    {
      name: 'fixture',
      basePath: '/gateway/docs',
      pathKey: 'publication',
      digestKey: 'artifactDigest',
    },
    {
      name: 'fixture-root',
      basePath: '/gateway',
      pathKey: 'rootPublication',
      digestKey: 'rootArtifactDigest',
    },
    {
      name: 'fixture-standalone',
      basePath: '',
      pathKey: 'standalonePublication',
      digestKey: 'standaloneArtifactDigest',
    },
  ];
  for (const item of publications) {
    const publication = join(candidate.output, item.name);
    await cp(join(repository, 'examples/demo'), publication, {
      recursive: true,
      filter: (file) =>
        !file.includes('.doctopus') && !file.includes('.api-docs'),
    });
    const config = join(publication, 'docs.config.yaml');
    const value = parseSource(
      await readFile(config, 'utf8'),
      'docs.config.yaml',
    );
    value.basePath = item.basePath;
    await writeFile(config, JSON.stringify(value, null, 2) + '\n');
    await buildSite(publication);
    candidate[item.pathKey] = join(publication, '.doctopus/site');
    const manifest = JSON.parse(
      await readFile(join(candidate[item.pathKey], 'manifest.json'), 'utf8'),
    );
    candidate.report[item.digestKey] = manifest.artifactDigest;
  }
}
export async function saveJavaCandidate(candidate) {
  await writeFile(
    join(candidate.output, 'report.json'),
    JSON.stringify(candidate.report, null, 2) + '\n',
  );
}
export async function currentConsumerResults(directory, hostSuite) {
  const requiredCases = new Map([
    [
      'dev.niessen.doctopus.consumer.PackagedPublicationTest',
      ['publicClassesComeFromTheExactInstalledJarsAndVerifyTheRealPublication'],
    ],
    [
      'dev.niessen.doctopus.consumer.MvcConsumerTest',
      [
        'installedStarterWorksWithOnlyMvcBehindHostSecurityAndContextPath',
        'installedMvcStarterSupportsRootMountWithAContextPrefix',
        'installedMvcStarterSupportsRootMountWithoutAContextPrefix',
      ],
    ],
    [
      'dev.niessen.doctopus.consumer.ReactiveConsumerTest',
      [
        'installedStarterWorksWithOnlyWebFluxBehindHostSecurityAndContextPath',
        'installedReactiveStarterSupportsRootMountWithAContextPrefix',
        'installedReactiveStarterSupportsRootMountWithoutAContextPrefix',
      ],
    ],
  ]);
  const names = (await readdir(directory)).filter((name) =>
    /^TEST-.+\.xml$/.test(name),
  );
  assert.equal(
    names.length,
    2,
    'Both current packaged-publication and host suites must execute.',
  );
  const results = [];
  for (const name of names) {
    const xml = await readFile(join(directory, name), 'utf8');
    assert(
      Buffer.byteLength(xml) <= 4 * 1024 * 1024,
      'Oversized JUnit consumer report.',
    );
    const attributes = xml.match(/<testsuite\b([^>]*)>/)?.[1];
    assert(attributes, 'Invalid consumer JUnit report.');
    const counts = Object.fromEntries(
      ['tests', 'failures', 'errors', 'skipped'].map((key) => {
        const count = attributes.match(new RegExp(`\\b${key}="(\\d+)"`))?.[1];
        assert(count !== undefined, `Missing JUnit count ${key}.`);
        return [key, Number(count)];
      }),
    );
    assert(
      counts.tests > 0 &&
        counts.failures === 0 &&
        counts.errors === 0 &&
        counts.skipped === 0,
      'Installed consumer tests must run without failures or skips.',
    );
    const suite = name.slice(5, -4);
    const cases = [...xml.matchAll(/<testcase\b([^>]*)>/g)].map((entry) =>
      entry[1].match(/\bname="([^"]+)"/)?.[1]?.replace(/\(\)$/, ''),
    );
    assert.equal(
      cases.length,
      counts.tests,
      'JUnit case and summary counts disagree.',
    );
    const expected = requiredCases.get(suite);
    assert(
      expected && expected.every((name) => cases.includes(name)),
      'Every required installed-consumer scenario must execute.',
    );
    results.push({ suite, ...counts, cases });
  }
  assert(
    results.some(
      (entry) =>
        entry.suite === 'dev.niessen.doctopus.consumer.PackagedPublicationTest',
    ) &&
      results.some(
        (entry) => entry.suite === `dev.niessen.doctopus.consumer.${hostSuite}`,
      ),
    'Required installed consumer suites did not execute.',
  );
  return results;
}

export async function testJavaConsumers(
  candidate,
  {
    environment = candidate.environment,
    boot = candidate.report.baselineBoot,
    expectedJava,
  } = {},
) {
  assert(versionPattern.test(boot), 'Invalid consumer Spring Boot version.');
  const java = await runtimeVersion(environment);
  if (expectedJava !== undefined)
    assert.equal(
      Number(java.split('.')[0]),
      Number(expectedJava),
      'The configured JDK does not match the selected matrix entry.',
    );
  const core = candidate.report.artifacts.find(
      (entry) => entry.module === 'core',
    ),
    starter = candidate.report.artifacts.find(
      (entry) => entry.module === 'spring-boot-starter',
    );
  assert(
    core && starter,
    'Candidate inspection must complete before consumption.',
  );
  for (const mode of ['mvc', 'reactive']) {
    const directory = await mkdtemp(join(tmpdir(), 'doctopus-installed-java-'));
    const entry = { java, boot, mode, passed: false };
    candidate.report.consumers.push(entry);
    const prefix = `java-${java.split('.')[0]}-boot-${boot}-${mode}`;
    try {
      const hostSuite =
        mode === 'mvc' ? 'MvcConsumerTest' : 'ReactiveConsumerTest';
      const target = join(
        directory,
        'src/test/java/dev/niessen/doctopus/consumer',
      );
      await mkdir(target, { recursive: true });
      for (const name of [
        'PackagedPublicationTest.java',
        'HostProbe.java',
        hostSuite + '.java',
      ])
        await cp(join(fixture, name), join(target, name));
      const pom = (await readFile(join(fixture, 'pom.xml'), 'utf8'))
        .replaceAll('__BOOT_VERSION__', boot)
        .replaceAll('__DOCTOPUS_VERSION__', candidate.report.version)
        .replaceAll(
          '__WEB_STARTER__',
          mode === 'mvc'
            ? 'spring-boot-starter-web'
            : 'spring-boot-starter-webflux',
        );
      assert(!pom.includes('__'), 'Unexpanded consumer POM token.');
      await writeFile(join(directory, 'pom.xml'), pom);
      const args = [
        ...candidate.args,
        '--batch-mode',
        '--no-transfer-progress',
        '--strict-checksums',
        `-Dconsumer.fixture=${candidate.publication}`,
        `-Dconsumer.artifactDigest=${candidate.report.artifactDigest}`,
        `-Dconsumer.rootFixture=${candidate.rootPublication}`,
        `-Dconsumer.rootArtifactDigest=${candidate.report.rootArtifactDigest}`,
        `-Dconsumer.standaloneFixture=${candidate.standalonePublication}`,
        `-Dconsumer.standaloneArtifactDigest=${candidate.report.standaloneArtifactDigest}`,
        `-Dconsumer.sourceRoot=${repository}`,
        `-Dconsumer.core.sha256=${core.sha256}`,
        `-Dconsumer.starter.sha256=${starter.sha256}`,
      ];
      await run(candidate.maven, [...args, 'test'], {
        cwd: directory,
        environment,
        log: join(candidate.output, prefix + '.log'),
      });
      entry.suites = await currentConsumerResults(
        join(directory, 'target/surefire-reports'),
        hostSuite,
      );
      await rm(join(directory, 'target/test-classes'), {
        recursive: true,
        force: true,
      });
      await run(candidate.maven, [...args, '--offline', 'test-compile'], {
        cwd: directory,
        environment,
        log: join(candidate.output, prefix + '-offline.log'),
      });
      entry.offlineCompilationPassed = true;
      entry.passed = true;
      console.log(
        `PASS installed Java ${java} / Boot ${boot} / ${mode}: ${entry.suites.reduce((sum, suite) => sum + suite.tests, 0)} tests, no skips; offline compilation passed`,
      );
    } catch (error) {
      entry.failure =
        'Installed consumer failed; inspect its retained validation log.';
      throw error;
    } finally {
      await saveJavaCandidate(candidate);
      await rm(directory, { recursive: true, force: true });
    }
  }
}
