import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { compileProject } from '@davidniessen/doctopus-compiler';
import { runPluginFiles } from '@davidniessen/doctopus-plugin-sdk';
import { goSnippet } from '../examples/snippet-plugin/go-code.mjs';

const exec = promisify(execFile);
const go = process.env.GO_EXECUTABLE ?? 'go';
const version = (await exec(go, ['version'])).stdout.trim();
assert.match(
  version,
  /^go version go1\.(?:2[3-9]|[3-9][0-9])\./,
  'Use a real Go toolchain, version 1.23 or newer',
);
const directory = await mkdtemp(join(tmpdir(), 'doctopus-go-snippets-'));
const requests = [];
let redirectHits = 0;
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk.toString('utf8');
  requests.push({
    method: request.method,
    url: request.url,
    headers: request.headers,
    rawHeaders: request.rawHeaders,
    body,
  });
  if (request.url.startsWith('/redirect-target')) redirectHits++;
  if (request.url.startsWith('/redirect')) {
    response.writeHead(302, { Location: '/redirect-target' });
    response.end('redirect');
  } else if (request.url.startsWith('/failure')) {
    response.writeHead(500);
    response.end('failure');
  } else if (request.url.startsWith('/empty')) {
    response.writeHead(204);
    response.end();
  } else {
    response.setHeader('Content-Type', 'application/json');
    response.end(body || '{"ok":true}');
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const fixtures = [
  {
    name: 'precise JSON and Unicode',
    path: '/echo?name=Ada%20Lovelace',
    body: '{"id":9007199254740993,"precise":1.234567890123456789,"text":"Hello 🌍"}',
    type: 'application/json',
  },
  {
    name: 'escaped source strings',
    path: '/echo',
    body: 'Quotes " and \\ and\nnewlines\t🌍',
    type: 'text/plain',
  },
  { name: 'empty response', path: '/empty', method: 'GET', expected: '' },
  {
    name: 'vendor JSON',
    path: '/echo',
    body: '{"ok":true}',
    type: 'application/vnd.example+json',
  },
  {
    name: 'serialized form bytes',
    path: '/echo',
    body: 'name=Ada+Lovelace&tag=a%2Fb&tag=c',
    type: 'application/x-www-form-urlencoded',
  },
  {
    name: 'query and own headers',
    path: '/echo?tag=a&tag=b&empty=',
    method: 'GET',
    expected: '{"ok":true}',
  },
  {
    name: 'HTTP failure',
    path: '/failure',
    method: 'GET',
    expected: 'failure',
    fails: true,
  },
  {
    name: 'redirect refusal',
    path: '/redirect',
    method: 'GET',
    expected: 'redirect',
    fails: true,
  },
];
const environment = {
  ...process.env,
  GOTOOLCHAIN: 'local',
  GOPROXY: 'off',
  GOSUMDB: 'off',
  GOWORK: 'off',
  GO111MODULE: 'off',
  CGO_ENABLED: '0',
  GOPATH: join(directory, 'gopath'),
  GOCACHE: process.env.GOCACHE ?? join(tmpdir(), 'doctopus-go-build-cache'),
};
async function execute(code, index) {
  const source = join(directory, `example-${index}.go`);
  const binary = join(directory, `example-${index}`);
  await writeFile(source, code);
  await exec(go, ['build', '-trimpath', '-o', binary, source], {
    env: environment,
    timeout: 90_000,
  });
  try {
    return {
      ...(await exec(binary, [], { env: environment, timeout: 35_000 })),
      failed: false,
    };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { stdout: error.stdout, stderr: error.stderr, failed: true };
  }
}
try {
  let passed = 0;
  for (const fixture of fixtures) {
    const headers = {
      Accept: 'application/json',
      Authorization: 'Bearer YOUR_CREDENTIAL',
      ['__proto__']: 'own-header-fixture',
      'X-Fixture': 'safe fixture',
    };
    if (fixture.type) headers['Content-Type'] = fixture.type;
    const input = {
      method: fixture.method ?? 'POST',
      url: origin + fixture.path,
      headers,
      ...(fixture.body === undefined ? {} : { body: fixture.body }),
    };
    const before = requests.length;
    const result = await execute(goSnippet(input), passed);
    assert.equal(
      result.failed,
      fixture.fails ?? false,
      fixture.name + ': ' + result.stderr,
    );
    assert.equal(result.stdout, fixture.expected ?? fixture.body, fixture.name);
    assert.equal(
      requests.length,
      before + 1,
      fixture.name + ': unexpected requests',
    );
    const actual = requests.at(-1);
    assert.equal(actual.url, fixture.path);
    assert.equal(actual.method, input.method);
    assert.equal(actual.body, fixture.body ?? '');
    assert.equal(actual.headers.authorization, headers.Authorization);
    const rawHeaders = new Map(
      Array.from({ length: actual.rawHeaders.length / 2 }, (_, i) => [
        actual.rawHeaders[i * 2].toLowerCase(),
        actual.rawHeaders[i * 2 + 1],
      ]),
    );
    assert.equal(rawHeaders.get('__proto__'), 'own-header-fixture');
    assert.equal(actual.headers['content-type'], fixture.type);
    assert.equal(redirectHits, 0);
    passed++;
    console.log(`PASS Go: ${fixture.name}`);
  }
  const root = resolve('examples/snippet-plugin');
  const site = await compileProject(root, 'docs.config.yaml', {
    skipPlugins: true,
  });
  site.apis[0].servers = [origin];
  site.apis[0].operations[0].servers = [origin];
  const generated = await runPluginFiles(root, ['go.mjs'], site);
  const result = await execute(
    generated.site.apis[0].operations[0].codeSamples[0].code,
    passed,
  );
  assert.equal(result.failed, false, result.stderr);
  assert.equal(result.stdout, '{"ok":true}');
  assert.equal(requests.at(-1).url, '/projects/project-123');
  passed++;
  assert.equal(passed, 9);
  console.log(
    `PASS Go: public build plugin output\n${passed} executable Go checks passed (${version}); compilation used no module downloads.`,
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
