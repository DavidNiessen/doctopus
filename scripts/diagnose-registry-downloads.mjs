import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { releaseRequest } from './lib/release-http.mjs';
import {
  githubPackageHeaders,
  githubPackageRegistries,
} from './lib/github-packages.mjs';

// Read-only observations. Never print request headers, response bodies or signed redirect URLs.
const repository = process.env.GITHUB_REPOSITORY;
const registry = githubPackageRegistries(repository);
const version = process.env.DIAGNOSTIC_VERSION;
assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
const observations = [];
async function observe(address, kind, label, metadata = false) {
  const url = new URL(address);
  assert.equal(url.origin, new URL(registry[kind]).origin);
  assert(!url.username && !url.password && !url.hash && !url.search);
  try {
    const response = await fetch(url, {
      headers: githubPackageHeaders(kind),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    const location = response.headers.get('location');
    const target = location ? new URL(location, url) : null;
    observations.push({
      label,
      status: response.status,
      redirectOrigin: target?.origin ?? null,
      redirectHasQuery: target ? Boolean(target.search) : false,
    });
    if (metadata && response.status === 200) {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        assert(bytes <= 16 * 1024 * 1024);
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
    }
    await response.body?.cancel();
  } catch (error) {
    const code = error.cause?.code;
    observations.push({
      label,
      error: error instanceof Error ? error.name : 'unknown',
      code:
        typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)
          ? code
          : null,
    });
  }
}
async function download(address, kind, label, integrity) {
  const result = await releaseRequest(address, {
    headers: githubPackageHeaders(kind),
    maximum: 1024 * 1024,
    allowGitHubArtifactRedirect: true,
  });
  const sha256 = createHash('sha256').update(result.bytes).digest('hex');
  const integrityMatches = integrity
    ? integrity ===
      `sha512-${createHash('sha512').update(result.bytes).digest('base64')}`
    : null;
  observations.push({
    label,
    status: result.status,
    bytes: result.bytes.length,
    sha256,
    integrityMatches,
  });
  if (integrity) assert.equal(integrityMatches, true);
}
const name = `${registry.scope}/contracts`;
const metadata = await observe(
  `${registry.npm}/${encodeURIComponent(name)}`,
  'npm',
  'npm-metadata',
  true,
);
const archive = metadata?.versions?.[version]?.dist?.tarball;
if (typeof archive === 'string') {
  await observe(archive, 'npm', 'npm-archive');
  await download(
    archive,
    'npm',
    'npm-verified-download',
    metadata.versions[version].dist.integrity,
  );
}
const pom = `${registry.maven}/dev/niessen/doctopus-parent/${version}/doctopus-parent-${version}.pom`;
await observe(pom, 'maven', 'maven-parent');
await download(pom, 'maven', 'maven-download');
const report = JSON.stringify({ repository, version, observations }, null, 2);
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `\n\`\`\`json\n${report}\n\`\`\`\n`,
  );
