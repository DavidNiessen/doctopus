import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createServer,
  type Server,
  type ServerResponse,
  type IncomingMessage,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { lookup } from 'node:dns/promises';
import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { createHash } from 'node:crypto';
import {
  getCACertificates,
  setDefaultCACertificates,
  type TLSSocket,
} from 'node:tls';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
  chmod,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { downloadSpec, loadSpec } from '@davidniessen/doctopus-spec';
import { importRemoteSpec } from '@davidniessen/doctopus-cli';
import { isAllowedImportAddress } from '../packages/spec/src/remote-policy.js';

vi.mock('node:dns/promises', async (original) => {
  const actual = await original<typeof import('node:dns/promises')>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});
const exec = promisify(execFile);
const lookupAll: (
  hostname: string,
  options: LookupAllOptions,
) => Promise<LookupAddress[]> = lookup;
const mockedLookup = vi.mocked(lookupAll);
const yaml = Buffer.from(
  'openapi: 3.1.0\ninfo: {title: Imported fixture, version: v1}\npaths: {}\ncomponents:\n  schemas:\n    Identity:\n      type: object\n      properties:\n        id: {type: integer, example: 9007199254740993}\n',
);
const json = Buffer.from(
  '{"openapi":"3.1.0","info":{"title":"Imported JSON","version":"v1"},"paths":{},"components":{"schemas":{"Identity":{"type":"integer","example":9007199254740993}}}}\n',
);
const hash = (source: Buffer) =>
  createHash('sha256').update(source).digest('hex');
const servers: Server[] = [];
const directories: string[] = [];
const sockets = new Set<Duplex>();
const originalCAs = getCACertificates('default');
beforeEach(() => {
  const local = [
    process.env.no_proxy || process.env.NO_PROXY || '',
    '127.0.0.1',
    'remote-import.test',
    '[::1]',
  ]
    .filter(Boolean)
    .join(',');
  vi.stubEnv('NO_PROXY', local);
  vi.stubEnv('no_proxy', local);
});
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  mockedLookup.mockReset();
  setDefaultCACertificates(originalCAs);
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-import-'));
  directories.push(root);
  return root;
}
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture listener');
  return address.port;
}
async function fixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void = (
    _request,
    response,
  ) => response.end(yaml),
) {
  const port = await listen(createServer(handler));
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    url: origin + '/openapi',
    options: {
      allowedOrigins: [origin],
      allowHttp: true,
      allowPrivateNetwork: true,
    },
  };
}

describe('remote spec destination policy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.2.3',
    '192.168.1.1',
    '192.0.0.1',
    '192.0.2.3',
    '198.18.0.1',
    '198.51.100.3',
    '203.0.113.3',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '2002:7f00:1::',
    '2001:db8::1',
    '2001::1',
    '3fff::1',
  ])('denies non-public destinations by default: %s', (address) => {
    expect(isAllowedImportAddress(address, false)).toBe(false);
  });
  it('permits only explicit private ranges while metadata, mapped and reserved ranges stay denied', () => {
    for (const address of [
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '172.16.1.1',
      '192.168.1.1',
      '::1',
      'fd00::1',
    ])
      expect(isAllowedImportAddress(address, true)).toBe(true);
    for (const address of [
      '169.254.169.254',
      '0.0.0.0',
      'fe80::1',
      '::ffff:10.0.0.1',
      '192.0.2.1',
      '224.0.0.1',
    ])
      expect(isAllowedImportAddress(address, true)).toBe(false);
    for (const address of [
      '1.1.1.1',
      '8.8.8.8',
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
    ])
      expect(isAllowedImportAddress(address, false)).toBe(true);
  });
  it('rejects unexpected origins, schemes, credentials and private addresses before making a request', async () => {
    let requests = 0;
    const source = await fixture((_request, response) => {
      requests++;
      response.end(yaml);
    });
    await expect(
      downloadSpec(source.url, { ...source.options, allowHttp: false }),
    ).rejects.toThrow(/requires HTTPS/);
    await expect(
      downloadSpec(source.url, {
        ...source.options,
        allowedOrigins: ['https://example.test'],
      }),
    ).rejects.toThrow(/origin is not allowed/);
    await expect(
      downloadSpec(source.url, {
        ...source.options,
        allowPrivateNetwork: false,
      }),
    ).rejects.toThrow(/disallowed network/);
    await expect(
      downloadSpec(
        source.url.replace('http://', 'http://user:query-secret@'),
        source.options,
      ),
    ).rejects.toThrow(/without embedded credentials/);
    await expect(
      downloadSpec(source.url + '#fragment', source.options),
    ).rejects.toThrow(/without embedded credentials/);
    await expect(
      downloadSpec(source.url, {
        ...source.options,
        allowedOrigins: [source.origin + '/only-this-path'],
      }),
    ).rejects.toThrow(/exact HTTP/);
    expect(requests).toBe(0);
    await expect(
      downloadSpec(source.url, {
        ...source.options,
        allowedOrigins: ['http://*.example.test'],
      }),
    ).rejects.toThrow(/exact HTTP/);
  });
  it('rejects mixed public/private DNS answers instead of selecting only the public answer', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(
      downloadSpec('https://remote-import.test/openapi', {
        allowedOrigins: ['https://remote-import.test'],
      }),
    ).rejects.toThrow(/disallowed network/);
  });
});

describe('bounded remote snapshots and atomic installation', () => {
  it('preserves exact YAML and JSON bytes, digests and offline compiler compatibility', async () => {
    const source = await fixture();
    const root = await directory();
    const imported = await importRemoteSpec(root, source.url, {
      ...source.options,
      output: 'openapi.yaml',
      expectedSha256: hash(yaml),
    });
    expect(imported).toMatchObject({
      bytes: yaml.length,
      sha256: hash(yaml),
      origin: source.origin,
    });
    expect(await readFile(join(root, 'openapi.yaml'))).toEqual(yaml);
    if (process.platform !== 'win32')
      expect((await stat(join(root, 'openapi.yaml'))).mode & 0o777).toBe(0o600);
    expect(
      (await loadSpec(root, { id: 'imported', path: 'openapi.yaml' })).title,
    ).toBe('Imported fixture');
    const jsonSource = await fixture((_request, response) =>
      response.end(json),
    );
    await importRemoteSpec(root, jsonSource.url, {
      ...jsonSource.options,
      output: 'openapi.json',
    });
    expect(await readFile(join(root, 'openapi.json'))).toEqual(json);
    expect(await readFile(join(root, 'openapi.json'), 'utf8')).toContain(
      '9007199254740993',
    );
    expect(await readdir(root)).toEqual(['openapi.json', 'openapi.yaml']);
  });
  it('does not follow redirects or expose source credentials in failures', async () => {
    let targetRequests = 0;
    const target = await fixture((_request, response) => {
      targetRequests++;
      response.end(yaml);
    });
    let headers: IncomingMessage['headers'] = {};
    const source = await fixture((request, response) => {
      headers = request.headers;
      response.writeHead(302, {
        location: target.url + '?secret=redirect-secret',
      });
      response.end('fixture-body-secret');
    });
    const promise = downloadSpec(source.url + '?secret=query-secret', {
      ...source.options,
      bearerToken: 'fixture-bearer-secret',
    });
    await expect(promise).rejects.toThrow('HTTP 302');
    await expect(promise).rejects.not.toThrow(
      /query-secret|redirect-secret|fixture-body-secret|fixture-bearer-secret/,
    );
    expect(targetRequests).toBe(0);
    expect(headers.authorization).toBe('Bearer fixture-bearer-secret');
  });
  it('enforces announced and streamed limits, content encoding, UTF-8, deadlines and cancellation', async () => {
    for (const handler of [
      (_request: IncomingMessage, response: ServerResponse) => {
        response.writeHead(200, { 'content-length': '1000' });
        response.end('x');
      },
      (_request: IncomingMessage, response: ServerResponse) => {
        response.write('x'.repeat(50));
        response.end('x'.repeat(50));
      },
    ]) {
      const source = await fixture(handler);
      await expect(
        downloadSpec(source.url, { ...source.options, maxBytes: 64 }),
      ).rejects.toThrow(/byte limit/);
    }
    const encoded = await fixture((_request, response) => {
      response.setHeader('content-encoding', 'gzip');
      response.end('compressed-fixture');
    });
    await expect(downloadSpec(encoded.url, encoded.options)).rejects.toThrow(
      /Compressed/,
    );
    const invalid = await fixture((_request, response) =>
      response.end(Buffer.from([0xff, 0xfe])),
    );
    await expect(downloadSpec(invalid.url, invalid.options)).rejects.toThrow(
      /UTF-8/,
    );
    const slow = await fixture((_request, _response) => {});
    await expect(
      downloadSpec(slow.url, { ...slow.options, timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/);
    const controller = new AbortController();
    controller.abort('private-abort-reason');
    const cancelled = downloadSpec(slow.url, {
      ...slow.options,
      signal: controller.signal,
    });
    await expect(cancelled).rejects.toThrow(/cancelled/);
    await expect(cancelled).rejects.not.toThrow('private-abort-reason');
  });
  it('rejects external refs, invalid source/schema and wrong pins without touching existing files', async () => {
    const root = await directory();
    const output = join(root, 'openapi.yaml');
    await writeFile(output, 'existing-local-spec');
    for (const data of [
      Buffer.from('openapi: [invalid'),
      Buffer.from('openapi: 3.1.0\ninfo: {title: missing-version}\npaths: {}'),
      Buffer.from(
        yaml.toString() +
          'x-fixture: { $ref: "http://169.254.169.254/metadata" }\n',
      ),
      Buffer.from(yaml.toString() + 'x-fixture: { $ref: "./outside.yaml" }\n'),
    ]) {
      const source = await fixture((_request, response) => response.end(data));
      await expect(
        importRemoteSpec(root, source.url, {
          ...source.options,
          replace: true,
        }),
      ).rejects.toThrow(/validation|external references/);
      expect(await readFile(output, 'utf8')).toBe('existing-local-spec');
    }
    const source = await fixture();
    await expect(
      importRemoteSpec(root, source.url, {
        ...source.options,
        replace: true,
        expectedSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/SHA-256/);
    await expect(
      importRemoteSpec(root, source.url, {
        ...source.options,
        output: 'wrong.json',
      }),
    ).rejects.toThrow(/JSON output requires JSON/);
    expect(await readdir(root)).toEqual(['openapi.yaml']);
  });
  it('refuses accidental overwrites and symlink escapes before downloading', async () => {
    const root = await directory();
    const outside = await directory();
    await writeFile(join(root, 'openapi.yaml'), 'existing-local-spec');
    await symlink(outside, join(root, 'escape'));
    await symlink(join(root, 'openapi.yaml'), join(root, 'link.yaml'));
    let requests = 0;
    const source = await fixture((_request, response) => {
      requests++;
      response.end(yaml);
    });
    for (const output of [
      'openapi.yaml',
      '../outside.yaml',
      'escape/openapi.yaml',
      'link.yaml',
    ])
      await expect(
        importRemoteSpec(root, source.url, { ...source.options, output }),
      ).rejects.toThrow(/exists|escapes|symlink/);
    expect(requests).toBe(0);
    expect(await readFile(join(root, 'openapi.yaml'), 'utf8')).toBe(
      'existing-local-spec',
    );
    expect(await readdir(outside)).toEqual([]);
  });
  it('refreshes an existing snapshot while preserving permissions and concurrent local edits', async () => {
    const root = await directory();
    const output = join(root, 'openapi.yaml');
    await writeFile(output, 'old-local-spec');
    await chmod(output, 0o640);
    const source = await fixture();
    await importRemoteSpec(root, source.url, {
      ...source.options,
      replace: true,
    });
    expect(await readFile(output)).toEqual(yaml);
    if (process.platform !== 'win32')
      expect((await stat(output)).mode & 0o777).toBe(0o640);
    const edited = await fixture((_request, response) => {
      void writeFile(output, 'concurrent-local-edit').then(() =>
        response.end(yaml),
      );
    });
    await expect(
      importRemoteSpec(root, edited.url, { ...edited.options, replace: true }),
    ).rejects.toThrow(/local edit was preserved/);
    expect(await readFile(output, 'utf8')).toBe('concurrent-local-edit');
    expect(await readdir(root)).toEqual(['openapi.yaml']);
  });
  it('preserves a destination created while the import is downloading', async () => {
    const root = await directory();
    const source = await fixture((_request, response) => {
      void writeFile(join(root, 'openapi.yaml'), 'concurrent-new-file').then(
        () => response.end(yaml),
      );
    });
    await expect(
      importRemoteSpec(root, source.url, source.options),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(root, 'openapi.yaml'), 'utf8')).toBe(
      'concurrent-new-file',
    );
    expect(await readdir(root)).toEqual(['openapi.yaml']);
  });
  it('accepts self-contained recursive references without changing their source representation', async () => {
    const recursive = Buffer.from(
      yaml.toString() +
        '    Node:\n      type: object\n      properties:\n        next: { $ref: "#/components/schemas/Node" }\n',
    );
    const source = await fixture((_request, response) =>
      response.end(recursive),
    );
    const snapshot = await downloadSpec(source.url, source.options);
    expect(snapshot.source).toEqual(recursive);
  });
  it('does not expose proxy credentials in configuration failures', async () => {
    const source = await fixture();
    vi.stubEnv('HTTP_PROXY', 'http://user:fixture-proxy-secret@[');
    vi.stubEnv('http_proxy', 'http://user:fixture-proxy-secret@[');
    vi.stubEnv('NO_PROXY', '');
    vi.stubEnv('no_proxy', '');
    try {
      await downloadSpec(source.url, source.options);
      throw new Error('Expected invalid proxy configuration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('proxy configuration');
      expect(String(error)).not.toContain('fixture-proxy-secret');
      expect(Object.hasOwn(error as object, 'input')).toBe(false);
    }
  });
  it('the real CLI imports authenticated snapshots without logging tokens or query strings', async () => {
    const root = await directory();
    const source = await fixture((request, response) => {
      expect(request.headers.authorization).toBe('Bearer fixture-cli-secret');
      response.end(json);
    });
    const result = await exec(
      process.execPath,
      [
        resolve('packages/cli/dist/main.js'),
        'import-spec',
        source.url + '?token=query-secret',
        root,
        '--allow-origin',
        source.origin,
        '--allow-http',
        '--allow-private-network',
        '--output',
        'openapi.json',
        '--bearer-env',
        'DOCTOPUS_IMPORT_TEST_TOKEN',
      ],
      {
        env: {
          ...process.env,
          DOCTOPUS_IMPORT_TEST_TOKEN: 'fixture-cli-secret',
        },
        timeout: 10_000,
      },
    );
    expect(result.stdout).toContain(hash(json));
    expect(result.stdout + result.stderr).not.toMatch(
      /fixture-cli-secret|query-secret/,
    );
    expect(await readFile(join(root, 'openapi.json'))).toEqual(json);
  });
});

it('pins DNS through an HTTP proxy, verifies TLS/SNI and keeps origin credentials inside the tunnel', async () => {
  const certificate = await readFile(
    new URL('./fixtures/remote-import/fixture-cert.pem', import.meta.url),
    'utf8',
  );
  const key = await readFile(
    new URL('./fixtures/remote-import/fixture-key.pem', import.meta.url),
    'utf8',
  );
  let receivedHost: string | undefined;
  let receivedAuthorization: string | undefined;
  let receivedServername: TLSSocket['servername'] | undefined;
  let receivedProxyAuthorization: string | undefined;
  const tlsPort = await listen(
    createHttpsServer({ cert: certificate, key }, (request, response) => {
      receivedHost = request.headers.host;
      receivedAuthorization = request.headers.authorization;
      receivedProxyAuthorization = request.headers['proxy-authorization'];
      receivedServername = (request.socket as TLSSocket).servername;
      response.end(json);
    }),
  );
  const proxy = createServer();
  let authority: string | undefined;
  let tunnelHeaders: IncomingMessage['headers'] = {};
  proxy.on('connect', (request, socket, head) => {
    authority = request.url;
    tunnelHeaders = request.headers;
    const target = connect({ host: '127.0.0.1', port: tlsPort });
    sockets.add(socket);
    sockets.add(target);
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
    target.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) target.write(head);
      socket.pipe(target).pipe(socket);
    });
  });
  const proxyPort = await listen(proxy);
  vi.stubEnv(
    'HTTPS_PROXY',
    `http://fixture-user:fixture-proxy-secret@127.0.0.1:${proxyPort}`,
  );
  vi.stubEnv(
    'https_proxy',
    `http://fixture-user:fixture-proxy-secret@127.0.0.1:${proxyPort}`,
  );
  vi.stubEnv('NO_PROXY', '');
  vi.stubEnv('no_proxy', '');
  mockedLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  const origin = `https://remote-import.test:${tlsPort}`;
  const options = {
    allowedOrigins: [origin],
    allowPrivateNetwork: true,
    bearerToken: 'fixture-origin-secret',
  };
  await expect(
    downloadSpec(origin + '/openapi?token=fixture-query-secret', options),
  ).rejects.toThrow(/TLS verification failed/);
  setDefaultCACertificates([...originalCAs, certificate]);
  mockedLookup.mockClear();
  mockedLookup
    .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    .mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
  const result = await downloadSpec(
    origin + '/openapi?token=fixture-query-secret',
    options,
  );
  expect(result.source).toEqual(json);
  expect(result.origin).toBe(origin);
  expect(mockedLookup).toHaveBeenCalledTimes(1);
  expect(authority).toBe('127.0.0.1:' + tlsPort);
  expect(receivedHost).toBe('remote-import.test:' + tlsPort);
  expect(receivedServername).toBe('remote-import.test');
  expect(receivedAuthorization).toBe('Bearer fixture-origin-secret');
  expect(receivedProxyAuthorization).toBeUndefined();
  expect(tunnelHeaders.authorization).toBeUndefined();
  expect(tunnelHeaders['proxy-authorization']).toBe(
    'Basic ' +
      Buffer.from('fixture-user:fixture-proxy-secret').toString('base64'),
  );
});
