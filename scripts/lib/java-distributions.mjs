import assert from 'node:assert/strict';
const group = 'dev.niessen';
const digest = /^[a-f0-9]{64}$/;
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateSpringMetadata(metadata) {
  assert(
    record(metadata) &&
      Array.isArray(metadata.groups) &&
      Array.isArray(metadata.properties),
    'Invalid Spring configuration metadata.',
  );
  assert(
    metadata.groups.some(
      (entry) =>
        entry.name === 'doctopus' &&
        entry.type === 'dev.niessen.doctopus.spring.DoctopusProperties',
    ),
    'Missing Spring configuration group.',
  );
  const names = [
    'artifact-digest',
    'directory',
    'enabled',
    'path',
    'public-base-path',
  ].map((name) => 'doctopus.' + name);
  assert.equal(
    metadata.properties.length,
    names.length,
    'Unexpected Spring configuration properties.',
  );
  const properties = names.map((name) => {
    const entries = metadata.properties.filter((entry) => entry.name === name);
    assert.equal(
      entries.length,
      1,
      `Missing or duplicate Spring property ${name}.`,
    );
    const entry = entries[0];
    assert.equal(
      entry.type,
      name === 'doctopus.enabled' ? 'java.lang.Boolean' : 'java.lang.String',
    );
    assert.equal(
      entry.sourceType,
      'dev.niessen.doctopus.spring.DoctopusProperties',
    );
    assert(
      typeof entry.description === 'string' && entry.description.length >= 10,
      'Spring properties need useful descriptions.',
    );
    return entry;
  });
  assert.equal(
    properties.find((entry) => entry.name === 'doctopus.enabled').defaultValue,
    true,
  );
  assert.equal(
    properties.find((entry) => entry.name === 'doctopus.path').defaultValue,
    '/docs',
  );
  for (const entry of properties.filter(
    (entry) => !['doctopus.enabled', 'doctopus.path'].includes(entry.name),
  ))
    assert(
      entry.defaultValue === undefined || entry.defaultValue === null,
      'Unset Spring properties must not advertise defaults.',
    );
  return properties;
}

/** Add exact inspected own-artifact hashes; leave the generated third-party inventory intact. */
export function bindJavaSbom(input, { version, artifacts, parentPom }) {
  assert(
    record(input) &&
      input.bomFormat === 'CycloneDX' &&
      input.specVersion === '1.6' &&
      input.version === 1,
    'Expected a CycloneDX 1.6 Java SBOM.',
  );
  assert(
    Array.isArray(input.components) &&
      input.components.length > 0 &&
      input.components.length <= 2000 &&
      Array.isArray(input.dependencies),
    'Invalid Java SBOM graph.',
  );
  const bom = structuredClone(input),
    root = bom.metadata?.component;
  assert(
    record(root) &&
      root.group === group &&
      root.name === 'doctopus-parent' &&
      root.version === version,
    'Java SBOM root coordinates disagree.',
  );
  const components = [root, ...bom.components],
    refs = new Set();
  for (const component of components) {
    assert(
      record(component) &&
        typeof component['bom-ref'] === 'string' &&
        component['bom-ref'].length <= 2048 &&
        component['bom-ref'].startsWith('pkg:maven/') &&
        component.purl === component['bom-ref'],
      'Invalid Maven component identity.',
    );
    assert(!refs.has(component['bom-ref']), 'Duplicate Java SBOM component.');
    refs.add(component['bom-ref']);
    assert(
      typeof component.group === 'string' &&
        typeof component.name === 'string' &&
        typeof component.version === 'string' &&
        component.version.length > 0,
      'Incomplete Java dependency coordinates.',
    );
    assert.equal(
      component.purl.split('?')[0],
      `pkg:maven/${encodeURIComponent(component.group)}/${encodeURIComponent(component.name)}@${encodeURIComponent(component.version)}`,
      'Maven package URL and component coordinates disagree.',
    );
    assert(
      component.group !== 'junit' &&
        !/^org\.(?:junit|mockito|assertj|hamcrest)(?:\.|$)/.test(
          component.group,
        ) &&
        !(
          component.group === 'org.springframework.boot' &&
          /^(?:spring-boot-test|spring-boot-test-autoconfigure|spring-boot-starter-test)$/.test(
            component.name,
          )
        ) &&
        !(
          component.group === 'org.springframework' &&
          component.name === 'spring-test'
        ),
      'Test dependencies must be excluded from the Java SBOM.',
    );
  }
  assert(
    components.some(
      (entry) =>
        entry.group === 'com.google.code.gson' && entry.name === 'gson',
    ),
    'The core JSON dependency is missing from the Java SBOM.',
  );
  const graph = new Map();
  for (const dependency of bom.dependencies) {
    assert(
      record(dependency) &&
        refs.has(dependency.ref) &&
        !graph.has(dependency.ref) &&
        Array.isArray(dependency.dependsOn) &&
        dependency.dependsOn.length <= 2000,
      'Invalid Java SBOM dependency node.',
    );
    assert(
      dependency.dependsOn.every((ref) => refs.has(ref)) &&
        new Set(dependency.dependsOn).size === dependency.dependsOn.length,
      'Dangling or duplicate Java SBOM dependency.',
    );
    graph.set(dependency.ref, dependency.dependsOn);
  }
  assert.equal(
    graph.size,
    refs.size,
    'Every Java component needs a dependency node.',
  );
  const reached = new Set(),
    pending = [root['bom-ref']];
  while (pending.length) {
    const ref = pending.pop();
    if (reached.has(ref)) continue;
    reached.add(ref);
    pending.push(...graph.get(ref));
  }
  assert.equal(
    reached.size,
    refs.size,
    'The Java dependency inventory contains unreachable components.',
  );
  function bind(component, sha256) {
    assert(digest.test(sha256), 'Invalid Java candidate SHA-256.');
    assert(
      Array.isArray(component.licenses) &&
        component.licenses.some(
          (entry) =>
            entry.license?.id === 'Apache-2.0' ||
            entry.expression === 'Apache-2.0',
        ),
      'Own Java components must declare the Apache license.',
    );
    if (component.hashes !== undefined)
      assert(Array.isArray(component.hashes), 'Invalid own-artifact hashes.');
    const hashes = component.hashes ?? [];
    for (const hash of hashes.filter((entry) => entry.alg === 'SHA-256'))
      assert.equal(
        hash.content,
        sha256,
        'Java SBOM checksum disagrees with the inspected artifact.',
      );
    component.hashes = [
      ...hashes.filter((entry) => entry.alg !== 'SHA-256'),
      { alg: 'SHA-256', content: sha256 },
    ];
  }
  bind(root, parentPom.sha256);
  assert.equal(
    artifacts.length,
    2,
    'Expected the core and starter runtime candidates.',
  );
  assert.deepEqual(
    artifacts.map((entry) => entry.artifact).sort(),
    ['doctopus-core', 'doctopus-spring-boot-starter'],
    'The core and starter candidates must both be present.',
  );
  for (const artifact of artifacts) {
    const matches = bom.components.filter(
      (entry) => entry.group === group && entry.name === artifact.artifact,
    );
    assert.equal(matches.length, 1, 'Missing or duplicate own Java component.');
    assert.equal(
      matches[0].version,
      version,
      'Java SBOM artifact version disagrees.',
    );
    bind(matches[0], artifact.sha256);
  }
  return bom;
}
