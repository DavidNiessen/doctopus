import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateContainerSecurity,
  vulnerabilityScanner,
} from '../lib/container-security.mjs';
import { verifyScanner } from '../lib/container-inventory.mjs';

const image = 'sha256:' + 'a'.repeat(64);
const now = Date.parse('2026-10-23T12:00:00Z');
const fixture = {
  source: { type: 'image', target: { manifestDigest: image.slice(7) } },
  descriptor: {
    name: 'grype',
    version: vulnerabilityScanner.version,
    timestamp: '2026-10-23T12:00:00Z',
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
        schemaVersion: 'v6.1.10',
        valid: true,
        from:
          'https://grype.anchore.io/databases/v6/database.tar.zst?checksum=sha256:' +
          'b'.repeat(64),
        built: '2026-10-23T06:30:00Z',
      },
    },
  },
  matches: [],
};
const match = (severity, state = 'not-fixed') => ({
  vulnerability: {
    id: 'CVE-2026-12345',
    namespace: 'alpine:distro:alpine:3.24',
    severity,
    fix: { state },
  },
  artifact: { name: 'example', version: '1.0.0' },
});
test('accepts a verified fresh zero-match assessment and retains nonblocking findings for review', () => {
  assert.equal(validateContainerSecurity(fixture, image, now).passed, true);
  const report = structuredClone(fixture);
  report.matches.push(match('Medium'), match('Low'), match('Negligible'));
  const result = validateContainerSecurity(report, image, now);
  assert.equal(result.passed, true);
  assert.equal(result.matches, 3);
  assert.equal(result.severities.Medium, 1);
});
test('blocks critical, high and unknown findings even when fixes are unavailable or declined', () => {
  for (const severity of ['Critical', 'High', 'Unknown'])
    for (const state of ['fixed', 'not-fixed', 'wont-fix', 'unknown', '']) {
      const report = structuredClone(fixture);
      report.matches = [match(severity, state)];
      const result = validateContainerSecurity(report, image, now);
      assert.equal(result.passed, false);
      assert.equal(result.blockingMatches, 1);
    }
});
test('rejects stale or future evidence, invalid databases, another subject and malformed findings', () => {
  for (const mutate of [
    (r) => {
      r.source.target.manifestDigest = 'c'.repeat(64);
    },
    (r) => {
      r.descriptor.version = '0.120.0';
    },
    (r) => {
      r.descriptor.db.status.valid = false;
    },
    (r) => {
      r.descriptor.db.status.built = '2026-10-21T11:59:59Z';
    },
    (r) => {
      r.descriptor.db.status.built = '2026-10-23T12:06:00Z';
    },
    (r) => {
      r.descriptor.timestamp = '2026-10-22T11:59:59Z';
    },
    (r) => {
      r.descriptor.timestamp = 'not a timestamp';
    },
    (r) => {
      r.descriptor.db.status.from =
        'http://grype.anchore.io/databases/v6/db.tar.zst';
    },
    (r) => {
      r.descriptor.db.status.from =
        'https://untrusted.example/databases/v6/db.tar.zst?checksum=sha256:' +
        'b'.repeat(64);
    },
    (r) => {
      r.matches = [match('Informational')];
    },
    (r) => {
      r.matches = [match('High', 'unrecognized')];
    },
    (r) => {
      r.matches = [match('High')];
      delete r.matches[0].artifact.version;
    },
    (r) => {
      delete r.matches;
    },
  ]) {
    const report = structuredClone(fixture);
    mutate(report);
    assert.throws(() => validateContainerSecurity(report, image, now));
  }
});
test('rejects hidden findings, exclusion filters, VEX waivers and weakened database verification', () => {
  for (const mutate of [
    (r) => {
      r.ignoredMatches = [match('High')];
    },
    (r) => {
      r.ignoredMatches = {};
    },
    (r) => {
      r.descriptor.configuration['only-fixed'] = true;
    },
    (r) => {
      r.descriptor.configuration['only-notfixed'] = true;
    },
    (r) => {
      r.descriptor.configuration['ignore-wontfix'] = 'debian';
    },
    (r) => {
      r.descriptor.configuration.exclude = ['/app'];
    },
    (r) => {
      r.descriptor.configuration['vex-documents'] = ['waiver.json'];
    },
    (r) => {
      r.descriptor.configuration['vex-add'] = ['not_affected'];
    },
    (r) => {
      r.descriptor.configuration['show-suppressed'] = false;
    },
    (r) => {
      r.descriptor.configuration['include-matcher-suppressions'] = false;
    },
    (r) => {
      r.descriptor.configuration.db['validate-age'] = false;
    },
    (r) => {
      r.descriptor.configuration.db['validate-by-hash-on-start'] = false;
    },
    (r) => {
      r.descriptor.configuration.db['max-allowed-built-age'] *= 2;
    },
  ]) {
    const report = structuredClone(fixture);
    mutate(report);
    assert.throws(() => validateContainerSecurity(report, image, now));
  }
});
test('refuses altered vulnerability scanner executables and links before execution', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-security-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'grype');
  await writeFile(path, 'altered executable');
  await assert.rejects(
    verifyScanner(path, vulnerabilityScanner),
    /integrity check failed/,
  );
  await symlink(path, join(root, 'linked'));
  await assert.rejects(
    verifyScanner(join(root, 'linked'), vulnerabilityScanner),
    /regular file/,
  );
});
