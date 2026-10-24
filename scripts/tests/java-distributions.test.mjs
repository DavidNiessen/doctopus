import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindJavaSbom,
  validateSpringMetadata,
} from '../lib/java-distributions.mjs';

function metadata() {
  return {
    groups: [
      {
        name: 'doctopus',
        type: 'dev.niessen.doctopus.spring.DoctopusProperties',
      },
    ],
    properties: [
      'artifact-digest',
      'directory',
      'enabled',
      'path',
      'public-base-path',
    ].map((name) => ({
      name: 'doctopus.' + name,
      type: name === 'enabled' ? 'java.lang.Boolean' : 'java.lang.String',
      sourceType: 'dev.niessen.doctopus.spring.DoctopusProperties',
      description: 'A useful description of ' + name,
      ...(name === 'enabled'
        ? { defaultValue: true }
        : name === 'path'
          ? { defaultValue: '/docs' }
          : {}),
    })),
  };
}
const group = 'dev.niessen',
  version = '0.2.0';
function component(group, name, version) {
  const ref = `pkg:maven/${group}/${name}@${version}?type=jar`;
  return {
    type: 'library',
    group,
    name,
    version,
    'bom-ref': ref,
    purl: ref,
    licenses: [{ license: { id: 'Apache-2.0' } }],
  };
}
function fixture() {
  const root = component(group, 'doctopus-parent', version),
    core = component(group, 'doctopus-core', version),
    starter = component(group, 'doctopus-spring-boot-starter', version),
    gson = component('com.google.code.gson', 'gson', '2.13.2');
  gson.hashes = [{ alg: 'SHA-256', content: 'd'.repeat(64) }];
  const ref = (entry) => entry['bom-ref'];
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: { component: root },
    components: [core, starter, gson],
    dependencies: [
      { ref: ref(root), dependsOn: [ref(core), ref(starter)] },
      { ref: ref(core), dependsOn: [ref(gson)] },
      { ref: ref(starter), dependsOn: [ref(core)] },
      { ref: ref(gson), dependsOn: [] },
    ],
  };
}
const options = {
  version,
  parentPom: { sha256: 'c'.repeat(64) },
  artifacts: [
    { artifact: 'doctopus-core', sha256: 'a'.repeat(64) },
    { artifact: 'doctopus-spring-boot-starter', sha256: 'b'.repeat(64) },
  ],
};

test('Spring metadata includes every documented property and real defaults', () => {
  const result = validateSpringMetadata(metadata());
  assert.equal(result.length, 5);
  assert.equal(
    result.find((entry) => entry.name === 'doctopus.enabled').defaultValue,
    true,
  );
  assert.equal(
    result.find((entry) => entry.name === 'doctopus.path').defaultValue,
    '/docs',
  );
});
test('Spring metadata rejects duplicates, missing descriptions and incorrect types/defaults', () => {
  for (const change of [
    (value) => value.properties.pop(),
    (value) => {
      value.properties[0] = value.properties[1];
    },
    (value) => {
      value.properties[0].description = '';
    },
    (value) => {
      value.properties[2].defaultValue = false;
    },
    (value) => {
      value.properties[3].defaultValue = '/wrong';
    },
    (value) => {
      value.properties[1].defaultValue = '/unexpected';
    },
    (value) => {
      value.properties[3].type = 'java.lang.Boolean';
    },
  ]) {
    const value = metadata();
    change(value);
    assert.throws(() => validateSpringMetadata(value));
  }
});
test('Java SBOM binds exact own artifacts without mutating the raw inventory or third-party hashes', () => {
  const raw = fixture(),
    before = structuredClone(raw),
    bound = bindJavaSbom(raw, options);
  assert.deepEqual(raw, before);
  assert.deepEqual(bound.components[2], before.components[2]);
  assert.deepEqual(bound.metadata.component.hashes, [
    { alg: 'SHA-256', content: options.parentPom.sha256 },
  ]);
  assert.deepEqual(bound.components[0].hashes, [
    { alg: 'SHA-256', content: options.artifacts[0].sha256 },
  ]);
});
test('Java SBOM rejects stale coordinates, mismatched hashes, missing licenses and duplicate candidates', () => {
  for (const change of [
    (value) => {
      value.metadata.component.version = '0.1.0';
    },
    (value) => {
      value.components[0].version = '0.1.0';
    },
    (value) => {
      value.components[0].hashes = [
        { alg: 'SHA-256', content: 'f'.repeat(64) },
      ];
    },
    (value) => {
      value.components[0].licenses = [];
    },
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => bindJavaSbom(value, options));
  }
  assert.throws(() =>
    bindJavaSbom(fixture(), {
      ...options,
      artifacts: [options.artifacts[0], options.artifacts[0]],
    }),
  );
});
test('Java SBOM rejects dangling, duplicate, unreachable and test dependencies', () => {
  for (const change of [
    (value) => {
      value.components[2].version = '999';
    },
    (value) => {
      value.dependencies[0].dependsOn.push('pkg:maven/missing/missing@1');
    },
    (value) => {
      value.components.push(value.components[0]);
    },
    (value) => {
      value.dependencies[0].dependsOn = [value.components[0]['bom-ref']];
    },
    (value) => {
      value.components[2].group = 'org.junit.jupiter';
    },
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => bindJavaSbom(value, options));
  }
});
