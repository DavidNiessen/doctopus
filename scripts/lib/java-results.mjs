import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const modules = ['core', 'spring-boot-starter'];
export async function clearJavaResults(javaRoot) {
  for (const module of modules)
    await rm(join(javaRoot, module, 'target/surefire-reports'), {
      recursive: true,
      force: true,
    });
}
export async function readJavaResults(javaRoot) {
  const suites = [];
  for (const module of modules) {
    const directory = join(javaRoot, module, 'target/surefire-reports');
    let names;
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error.code === 'ENOENT') names = [];
      else throw error;
    }
    names = names.filter((name) => /^TEST-.+\.xml$/.test(name));
    assert(names.length > 0, `${module}: no current JUnit reports`);
    for (const file of names) {
      const xml = await readFile(join(directory, file), 'utf8');
      const attributes = xml.match(/<testsuite\b([^>]*)>/)?.[1];
      assert(attributes, `${module}: invalid JUnit summary`);
      const counts = Object.fromEntries(
        ['tests', 'failures', 'errors', 'skipped'].map((name) => {
          const value = attributes.match(
            new RegExp(`\\b${name}="(\\d+)"`),
          )?.[1];
          assert(value !== undefined, `${module}: missing JUnit count ${name}`);
          return [name, Number(value)];
        }),
      );
      assert(
        counts.tests > 0 &&
          counts.failures === 0 &&
          counts.errors === 0 &&
          counts.skipped === 0,
        `${module}: tests must run without failures or skips`,
      );
      suites.push({ module, suite: file.slice(5, -4), ...counts });
    }
  }
  assert(
    suites.some(
      (suite) => suite.suite === 'dev.niessen.doctopus.core.ManifestTest',
    ) &&
      suites.some(
        (suite) =>
          suite.suite === 'dev.niessen.doctopus.spring.DoctopusIntegrationTest',
      ),
    'Required manifest and host tests must execute',
  );
  assert(
    [
      'dev.niessen.doctopus.core.DirectDocumentationTest',
      'dev.niessen.doctopus.spring.DirectIntegrationTest',
    ].every((required) => suites.some((suite) => suite.suite === required)),
    'Required bundled direct-mode tests must execute',
  );
  return suites;
}
