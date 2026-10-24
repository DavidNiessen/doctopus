import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  scanner,
  validateContainerInventory,
} from '../lib/container-inventory.mjs';
import {
  vulnerabilityScanner,
  validateContainerSecurity,
} from '../lib/container-security.mjs';
import {
  assessPublicationPreflight,
  bytesSha256,
  verifyPublicationPreflight,
} from '../lib/publication-preflight.mjs';

const now = Date.parse('2026-10-24T00:00:00Z');
const image = 'sha256:' + 'a'.repeat(64);
function fixture() {
  const context = {
    repository: 'DavidNiessen/doctopus',
    commit: 'b'.repeat(40),
    version: '0.2.0',
    ref: 'refs/tags/v0.2.0',
    runId: '123',
    runAttempt: '1',
  };
  const inventoryContext = {
    image,
    toolVersion: context.version,
    packages: ['@davidniessen/doctopus-server'],
    nodeRange: '>=24.22.1 <25',
  };
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.7',
    metadata: {
      component: { type: 'container', name: 'sha256', version: image.slice(7) },
      tools: { components: [{ name: scanner.name, version: scanner.version }] },
    },
    components: [
      {
        name: '@davidniessen/doctopus-server',
        version: '0.2.0',
        purl: 'pkg:npm/%40doctopus%2Fserver@0.2.0',
      },
      { name: 'fastify', version: '5.12.7', purl: 'pkg:npm/fastify@5.12.7' },
      { name: 'pg', version: '8.23.1', purl: 'pkg:npm/pg@8.23.1' },
      {
        name: 'musl',
        version: '1.2.6-r1',
        purl: 'pkg:apk/alpine/musl@1.2.6-r1',
      },
      { name: 'node', version: '24.22.1', purl: 'pkg:generic/node@24.22.1' },
      { name: '/app/LICENSE', type: 'file' },
    ],
    dependencies: [{ ref: 'server', dependsOn: ['fastify'] }],
  };
  const findings = {
    source: { type: 'image', target: { manifestDigest: image.slice(7) } },
    descriptor: {
      name: vulnerabilityScanner.name,
      version: vulnerabilityScanner.version,
      timestamp: new Date(now).toISOString(),
      configuration: {
        'only-fixed': false,
        'only-notfixed': false,
        'ignore-wontfix': '',
        exclude: [],
        'vex-documents': [],
        'vex-add': [],
        'show-suppressed': true,
        'include-matcher-suppressions': true,
        db: {
          'validate-age': true,
          'validate-by-hash-on-start': true,
          'max-allowed-built-age': 48 * 60 * 60 * 1e9,
        },
      },
      db: {
        status: {
          valid: true,
          schemaVersion: 'v6.1.10',
          from:
            'https://grype.anchore.io/databases/v6/database.tar.zst?checksum=sha256:' +
            'c'.repeat(64),
          built: new Date(now - 3600000).toISOString(),
        },
      },
    },
    matches: [],
  };
  const inventoryBytes = Buffer.from(JSON.stringify(bom)),
    findingsBytes = Buffer.from(JSON.stringify(findings));
  const expected = {
    context,
    publicationRunId: '456',
    publicationRunAttempt: '2',
    image,
    archiveSha256: 'd'.repeat(64),
    lockSha256: 'e'.repeat(64),
    inventoryContext,
  };
  const receipt = {
    schemaVersion: 1,
    purpose: 'publication-preflight',
    ...context,
    publicationRunId: '456',
    publicationRunAttempt: '2',
    image,
    archiveSha256: expected.archiveSha256,
    dependencyAudit: {
      passed: true,
      lockSha256: expected.lockSha256,
      auditedAt: new Date(now).toISOString(),
    },
    inventorySha256: bytesSha256(inventoryBytes),
    findingsSha256: bytesSha256(findingsBytes),
    counts: validateContainerInventory(bom, inventoryContext),
    assessment: validateContainerSecurity(findings, image, now),
    complete: true,
  };
  return { expected, receipt, inventoryBytes, findingsBytes };
}

test('fresh preflight binds current audit and raw image assessment to the original candidate and publishing attempt', () => {
  const f = fixture();
  const result = assessPublicationPreflight(
    f.receipt,
    f.inventoryBytes,
    f.findingsBytes,
    f.expected,
    now,
  );
  assert.equal(result.assessment.passed, true);
  assert.equal(result.audit.passed, true);
});

test('stale, different, tampered and newly vulnerable preflight evidence never authorizes publishing', () => {
  for (const mutate of [
    (f) => {
      f.receipt.purpose = 'candidate-rehearsal';
    },
    (f) => {
      f.receipt.commit = 'f'.repeat(40);
    },
    (f) => {
      f.receipt.runAttempt = '2';
    },
    (f) => {
      f.receipt.publicationRunId = '999';
    },
    (f) => {
      f.receipt.archiveSha256 = 'f'.repeat(64);
    },
    (f) => {
      f.receipt.image = 'sha256:' + 'f'.repeat(64);
    },
    (f) => {
      f.receipt.dependencyAudit.lockSha256 = 'f'.repeat(64);
    },
    (f) => {
      f.receipt.dependencyAudit.auditedAt = new Date(
        now - 25 * 3600000,
      ).toISOString();
    },
    (f) => {
      f.findingsBytes = Buffer.from('{}');
    },
    (f) => {
      const findings = JSON.parse(f.findingsBytes);
      findings.descriptor.timestamp = new Date(
        now - 25 * 3600000,
      ).toISOString();
      f.findingsBytes = Buffer.from(JSON.stringify(findings));
      f.receipt.findingsSha256 = bytesSha256(f.findingsBytes);
    },
    (f) => {
      const findings = JSON.parse(f.findingsBytes);
      findings.matches = [
        {
          vulnerability: {
            id: 'CVE-2026-12345',
            namespace: 'alpine:3.24',
            severity: 'High',
            fix: { state: 'not-fixed' },
          },
          artifact: { name: 'fixture', version: '1.0.0' },
        },
      ];
      f.findingsBytes = Buffer.from(JSON.stringify(findings));
      f.receipt.findingsSha256 = bytesSha256(f.findingsBytes);
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() =>
      assessPublicationPreflight(
        f.receipt,
        f.inventoryBytes,
        f.findingsBytes,
        f.expected,
        now,
      ),
    );
  }
});

test('fresh security reports require authentic hosted producer constraints and no empty verification results', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ad-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture();
  await writeFile(join(root, 'receipt.json'), JSON.stringify(f.receipt));
  await writeFile(join(root, 'server.cdx.json'), f.inventoryBytes);
  await writeFile(join(root, 'server.grype.json'), f.findingsBytes);
  const calls = [];
  const run = async (file, args) => {
    assert.equal(file, 'gh');
    assert.equal(
      args[args.indexOf('--signer-workflow') + 1],
      'DavidNiessen/doctopus/.github/workflows/release-publish.yml',
    );
    assert.equal(
      args[args.indexOf('--source-digest') + 1],
      f.expected.context.commit,
    );
    assert.equal(
      args[args.indexOf('--source-ref') + 1],
      f.expected.context.ref,
    );
    assert(args.includes('--deny-self-hosted-runners'));
    calls.push(args[2]);
    return { stdout: '[{"unitTestVerifierResult":true}]' };
  };
  const verified = await verifyPublicationPreflight(root, f.expected, {
    run,
    now,
  });
  assert.equal(calls.length, 3);
  assert(verified['receipt.json'].proof);
  await assert.rejects(
    verifyPublicationPreflight(root, f.expected, {
      run: async () => ({ stdout: '[]' }),
      now,
    }),
  );
  await writeFile(join(root, 'server.grype.json'), '{}');
  let called = false;
  await assert.rejects(
    verifyPublicationPreflight(root, f.expected, {
      run: async () => {
        called = true;
      },
      now,
    }),
  );
  assert.equal(called, false);
});
