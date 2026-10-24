import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  generateSnippet,
  encodeFormBody,
  createMultipartParts,
} from '@davidniessen/doctopus-explorer';

const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'doctopus-snippets-'));
const languages = ['cURL', 'JavaScript', 'TypeScript', 'Python', 'Java'];
const uploadBytes = Uint8Array.from([0, 255, 128, 13, 10, 34, 1, 254]);
const multipartMedia = {
  encoding: {
    documents: { headers: { 'X-Upload-Id': { schema: { type: 'integer' } } } },
  },
  schema: {
    allOf: [
      {
        type: 'object',
        properties: {
          metadata: { type: 'object' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      {
        type: 'object',
        properties: {
          documents: {
            type: 'array',
            items: { type: 'string', format: 'binary' },
          },
        },
      },
    ],
  },
};
const uploadParts = createMultipartParts(
  '{"metadata":{"id":9007199254740993},"tags":["a","b"]}',
  {
    documents: [
      { filename: 'private-fixture-name.bin', data: new Blob([uploadBytes]) },
      { filename: 'private-empty.bin', data: new Blob([]) },
    ],
  },
  multipartMedia,
  { partHeaders: { documents: { 'X-Upload-Id': '9007199254740993' } } },
);
const cases = [
  {
    name: 'get',
    status: 200,
    type: 'text/plain',
    body: 'bodyless request',
    expected: 'bodyless request',
    method: 'GET',
  },
  {
    name: 'json-body',
    status: 200,
    type: 'application/json',
    body: '{"received":true}',
    expected: 'received',
    requestBody: JSON.stringify({
      enabled: false,
      value: null,
      message: 'quotes " and \\ café 😀',
    }),
  },
  {
    name: 'form-body',
    status: 200,
    type: 'application/json',
    body: '{"encoded":true}',
    expected: 'encoded',
    requestType: 'application/x-www-form-urlencoded',
    requestBody: encodeFormBody(
      '{"name":"café + space","id":9007199254740993,"colors":["a+b","x&y"],"address":{"zip":"99999+1234"}}',
      {
        schema: { type: 'object' },
      },
    ),
  },
  {
    name: 'multipart-text',
    status: 200,
    type: 'application/json',
    body: '{"multipart":true}',
    expected: 'multipart',
    multipart: createMultipartParts(
      JSON.stringify({
        title: 'café 😀 "quotes" \\ and \u0000 NUL\r\nsecond line',
        tags: ['a', 'b'],
        clé: 'Unicode name',
      }).slice(0, -1) + ',"metadata":{"id":9007199254740993}}',
      {},
      multipartMedia,
    ),
  },
  {
    name: 'multipart-style',
    status: 200,
    type: 'application/json',
    body: '{"styled":true}',
    expected: 'styled',
    multipart: createMultipartParts(
      '{"tags":["a+b",9007199254740993],"meta":{"name":"café","active":false}}',
      {},
      {
        schema: { type: 'object' },
        encoding: {
          tags: { style: 'form', explode: false },
          meta: { style: 'deepObject', explode: true },
        },
      },
    ),
  },
  {
    name: 'multipart-files',
    status: 200,
    type: 'application/json',
    body: '{"uploaded":true}',
    expected: 'uploaded',
    multipart: uploadParts,
  },
  {
    name: 'multipart-error',
    status: 418,
    type: 'text/plain',
    body: 'upload rejected',
    fails: true,
    multipart: uploadParts,
  },
  {
    name: 'multipart-redirect',
    status: 302,
    type: 'text/plain',
    body: 'redirect',
    expected: 'redirect',
    multipart: uploadParts,
  },
  {
    name: 'json',
    status: 200,
    type: 'application/problem+json; charset=utf-8',
    body: '{"ok":true}',
    expected: 'ok',
  },
  {
    name: 'text',
    status: 200,
    type: 'text/plain',
    body: 'plain response',
    expected: 'plain response',
  },
  { name: 'empty', status: 204, type: 'text/plain', body: '', expected: '' },
  {
    name: 'error',
    status: 418,
    type: 'text/plain',
    body: 'fixture error',
    fails: true,
  },
  {
    name: 'redirect',
    status: 302,
    type: 'text/plain',
    body: 'redirect',
    expected: 'redirect',
  },
];
const received = [];
const server = createServer(async (request, response) => {
  const match = cases.find(
    (item) => request.url?.split('?')[0] === `/${item.name}`,
  );
  if (!match) {
    response.writeHead(500).end('unexpected destination');
    return;
  }
  const parts = [];
  for await (const part of request) parts.push(part);
  const bytes = Buffer.concat(parts);
  const body = bytes.toString('utf8');
  received.push({
    url: request.url,
    method: request.method,
    headers: request.headers,
    rawHeaders: [...request.rawHeaders],
    body,
    bytes,
  });
  response
    .writeHead(match.status, {
      'Content-Type': match.type,
      ...(match.status === 302 ? { Location: '/forbidden-follow' } : {}),
    })
    .end(match.body);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert(address && typeof address !== 'string');
let passed = 0;
try {
  for (const language of languages) {
    for (const fixture of cases) {
      const input = {
        url: `http://127.0.0.1:${address.port}/${fixture.name}?q=a%26b`,
        method: fixture.method ?? 'POST',
        headers: {
          Accept: fixture.type,
          'Content-Type':
            fixture.requestType ??
            (fixture.name === 'json-body'
              ? 'application/json'
              : 'text/plain; charset=utf-8'),
          Authorization: 'Bearer fixture-token',
          'X-Fixture': 'quote" backslash\\',
          'X-Empty': '',
        },
        ...(fixture.multipart
          ? { multipart: fixture.multipart }
          : fixture.method === 'GET'
            ? {}
            : {
                body:
                  fixture.requestBody ??
                  '@not-a-file\n  quotes "double" and \'single\' \\ café 😀  ',
              }),
      };
      Object.defineProperty(input.headers, '__proto__', {
        value: 'own-header-fixture',
        enumerable: true,
      });
      if (fixture.multipart) {
        let fileIndex = 0;
        for (const part of fixture.multipart)
          if (part.kind === 'file')
            await writeFile(
              join(directory, `YOUR_FILE_${++fileIndex}`),
              new Uint8Array(await part.file.data.arrayBuffer()),
            );
      }
      const extension = {
        cURL: 'sh',
        JavaScript: 'mjs',
        TypeScript: 'mts',
        Python: 'py',
        Java: 'java',
      }[language];
      const file = join(
        directory,
        language === 'Java' ? 'Example.java' : `example.${extension}`,
      );
      await writeFile(file, generateSnippet(input, language));
      const command = {
        cURL: 'sh',
        JavaScript: process.execPath,
        TypeScript: process.execPath,
        Python: 'python3',
        Java: 'java',
      }[language];
      let output = '',
        failed = false;
      const before = received.length;
      try {
        const result = await exec(command, [file], {
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
          cwd: directory,
        });
        output = result.stdout;
      } catch (error) {
        assert.equal(
          error.killed,
          false,
          `${language}/${fixture.name}: subprocess timed out`,
        );
        assert.equal(
          typeof error.code,
          'number',
          `${language}/${fixture.name}: required runtime is unavailable`,
        );
        failed = true;
      }
      // cURL reports 3xx without following; other clients reject redirects.
      const shouldFail = Boolean(
        fixture.fails || (fixture.status === 302 && language !== 'cURL'),
      );
      assert.equal(
        failed,
        shouldFail,
        `${language}/${fixture.name}: unexpected process result`,
      );
      assert.equal(
        received.length,
        before + 1,
        `${language}/${fixture.name}: exactly one request must arrive`,
      );
      const actual = received.at(-1);
      assert.equal(actual.url, `/${fixture.name}?q=a%26b`);
      assert.equal(actual.method, input.method);
      if (fixture.multipart) {
        assert.match(
          actual.headers['content-type'],
          /^multipart\/form-data; boundary=doctopus-[a-f0-9]+$/,
        );
        const form = await new Response(actual.bytes, {
          headers: { 'Content-Type': actual.headers['content-type'] },
        }).formData();
        const values = [...form.entries()];
        if (fixture.name === 'multipart-style')
          assert.deepEqual(values, [
            ['tags', 'a%2Bb,9007199254740993'],
            ['meta[name]', 'caf%C3%A9'],
            ['meta[active]', 'false'],
          ]);
        const boundary =
          actual.headers['content-type'].match(/boundary=([^;]+)/)[1];
        const rawParts = actual.bytes
          .toString('latin1')
          .split('--' + boundary)
          .slice(1, -1);
        assert.equal(rawParts.length, fixture.multipart.length);
        assert.equal(
          values.length,
          fixture.multipart.length,
          `${language}/${fixture.name}: wrong part count`,
        );
        let fileIndex = 0;
        for (let index = 0; index < fixture.multipart.length; index++) {
          const expected = fixture.multipart[index];
          const rawHeaders =
            rawParts[index].slice(0, rawParts[index].indexOf('\r\n\r\n')) +
            '\r\n';
          for (const [name, value] of Object.entries(expected.headers ?? {}))
            assert(
              rawHeaders.includes(`\r\n${name}: ${value}\r\n`),
              `${language}/${fixture.name}: custom part header missing`,
            );
          const [name, value] = values[index];
          assert.equal(name, expected.name);
          assert(
            actual.bytes.includes(
              Buffer.from(`\r\nContent-Type: ${expected.contentType}\r\n`),
            ),
            `${language}/${fixture.name}: part content type missing`,
          );
          if (expected.kind === 'file') {
            assert.equal(value.name, `upload-${++fileIndex}.bin`);
            assert.equal(value.type, expected.contentType);
            assert.deepEqual(
              new Uint8Array(await value.arrayBuffer()),
              new Uint8Array(await expected.file.data.arrayBuffer()),
              `${language}/${fixture.name}: uploaded bytes changed`,
            );
          } else
            assert.equal(
              value,
              new TextDecoder().decode(
                new TextEncoder().encode(expected.value),
              ),
              `${language}/${fixture.name}: text part changed`,
            );
        }
      } else {
        assert.equal(
          actual.body,
          input.body ?? '',
          `${language}/${fixture.name}: request bytes changed`,
        );
        assert.equal(actual.headers.accept, input.headers.Accept);
        assert.equal(
          actual.headers['content-type'],
          input.headers['Content-Type'],
        );
      }
      assert.equal(actual.headers.authorization, input.headers.Authorization);
      assert.equal(actual.headers['x-fixture'], input.headers['X-Fixture']);
      assert.equal(actual.headers['x-empty'], '');
      const wireHeaders = new Map(
        Array.from({ length: actual.rawHeaders.length / 2 }, (_, index) => [
          actual.rawHeaders[index * 2].toLowerCase(),
          actual.rawHeaders[index * 2 + 1],
        ]),
      );
      assert.equal(
        wireHeaders.get('__proto__'),
        'own-header-fixture',
        `${language}/${fixture.name}: own header missing`,
      );
      if (!shouldFail && fixture.expected)
        assert(
          output.includes(fixture.expected),
          `${language}/${fixture.name}: response was not displayed`,
        );
      passed++;
      console.log(`PASS ${language}: ${fixture.name}`);
    }
  }
  assert.equal(passed, 65);
  console.log(
    `${passed} executable snippet checks passed across ${languages.length} languages.`,
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
