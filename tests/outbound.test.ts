import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { requestAllowedOrigin } from '@davidniessen/doctopus-spec';
import type { OutboundRequestOptions } from '@davidniessen/doctopus-spec';
import { abortableOutbound } from '../packages/spec/src/outbound.js';

const servers: Server[] = [];
beforeEach(() => {
  const local = [
    process.env.NO_PROXY ?? process.env.no_proxy ?? '',
    '127.0.0.1',
  ]
    .filter(Boolean)
    .join(',');
  vi.stubEnv('NO_PROXY', local);
  vi.stubEnv('no_proxy', local);
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.unstubAllEnvs();
});
async function fixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    origin,
    options: {
      allowedOrigins: [origin],
      allowHttp: true,
      allowPrivateNetwork: true,
    } satisfies OutboundRequestOptions,
  };
}
it('carries exact binary request bytes, target credentials, original host and fixed framing', async () => {
  let received:
    | {
        headers: IncomingMessage['headers'];
        body: Buffer;
        method?: string;
        url?: string;
      }
    | undefined;
  const { origin, options } = await fixture(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    received = {
      headers: request.headers,
      body: Buffer.concat(chunks),
      method: request.method!,
      url: request.url!,
    };
    response.writeHead(201, {
      'Content-Type': 'application/octet-stream',
      'Set-Cookie': ['one=1', 'two=2'],
    });
    response.end(Buffer.from([0, 255, 128]));
  });
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  const result = await requestAllowedOrigin(
    origin + '/upload?key=visitor-secret',
    {
      ...options,
      method: 'POST',
      body: bytes,
      headers: {
        Authorization: 'Bearer target-secret',
        'Content-Type': 'application/octet-stream',
      },
    },
  );
  expect(received).toMatchObject({
    method: 'POST',
    url: '/upload?key=visitor-secret',
    body: bytes,
    headers: {
      authorization: 'Bearer target-secret',
      host: new URL(origin).host,
      'content-length': '5',
      'accept-encoding': 'identity',
    },
  });
  expect(received!.headers.cookie).toBeUndefined();
  expect(result).toMatchObject({
    status: 201,
    origin,
    body: Buffer.from([0, 255, 128]),
    headers: { 'set-cookie': ['one=1', 'two=2'] },
  });
});
it('returns redirect metadata without following it and enforces an expected status', async () => {
  let requests = 0;
  const { origin, options } = await fixture((_request, response) => {
    requests++;
    response
      .writeHead(302, { Location: '/private-redirect?token=secret' })
      .end('redirect');
  });
  expect(await requestAllowedOrigin(origin, options)).toMatchObject({
    status: 302,
    body: Buffer.from('redirect'),
  });
  await expect(
    requestAllowedOrigin(origin, { ...options, expectedStatus: 200 }),
  ).rejects.toThrow('HTTP 302');
  expect(requests).toBe(2);
});
it.each([
  'Cookie',
  'Host',
  'Content-Length',
  'Accept-Encoding',
  'Connection',
  'Transfer-Encoding',
  'Upgrade',
  'Proxy-Authorization',
  'Forwarded',
  'X-Forwarded-For',
  'X-Real-IP',
  'Expect',
  'Sec-Fetch-Site',
])('rejects transport/session-owned header %s before contact', async (name) => {
  let requests = 0;
  const { origin, options } = await fixture((_request, response) => {
    requests++;
    response.end();
  });
  await expect(
    requestAllowedOrigin(origin, {
      ...options,
      headers: { [name]: 'not-forwarded' },
    }),
  ).rejects.toThrow(/transport-owned/);
  expect(requests).toBe(0);
});
it('rejects case-duplicate, injected, non-Latin-1 and excessive headers without exposing values', async () => {
  const { origin, options } = await fixture((_request, response) =>
    response.end(),
  );
  for (const headers of [
    { Foo: 'a', foo: 'b' },
    { Authorization: 'private\r\nsecret' },
    { Authorization: 'private-🔑' },
    { 'X-Large': 'private'.repeat(3000) },
  ]) {
    const result = requestAllowedOrigin(origin, { ...options, headers });
    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toThrow('private');
  }
});
it('bounds request bytes and rejects bodies on GET/HEAD and unsupported methods', async () => {
  const { origin, options } = await fixture((_request, response) =>
    response.end(),
  );
  await expect(
    requestAllowedOrigin(origin, {
      ...options,
      method: 'POST',
      body: Buffer.alloc(10),
      maxRequestBytes: 9,
    }),
  ).rejects.toThrow(/body limit/);
  for (const method of ['GET', 'HEAD'] as const)
    await expect(
      requestAllowedOrigin(origin, { ...options, method, body: Buffer.of(1) }),
    ).rejects.toThrow(/method constraints/);
  await expect(
    requestAllowedOrigin(origin, { ...options, method: 'CONNECT' as 'GET' }),
  ).rejects.toThrow(/method/);
});
it('bounds declared and streamed response sizes and rejects unexpected compression', async () => {
  for (const mode of ['length', 'stream', 'gzip']) {
    const { origin, options } = await fixture((_request, response) => {
      if (mode === 'length') response.setHeader('Content-Length', '100');
      if (mode === 'gzip') response.setHeader('Content-Encoding', 'gzip');
      response.end('oversized');
    });
    await expect(
      requestAllowedOrigin(origin, { ...options, maxBytes: 4 }),
    ).rejects.toThrow(mode === 'gzip' ? /Compressed/ : /byte limit/);
  }
});
it('treats HEAD and 304 representation lengths as metadata rather than body allocation', async () => {
  const { origin, options } = await fixture((request, response) => {
    response
      .writeHead(request.method === 'HEAD' ? 200 : 304, {
        'Content-Length': '1000000000',
      })
      .end();
  });
  expect(
    await requestAllowedOrigin(origin, {
      ...options,
      method: 'HEAD',
      maxBytes: 1,
    }),
  ).toMatchObject({ status: 200, body: Buffer.alloc(0) });
  expect(
    await requestAllowedOrigin(origin, { ...options, maxBytes: 1 }),
  ).toMatchObject({ status: 304, body: Buffer.alloc(0) });
});
it('rejects protocol upgrades and closes the handed-off socket', async () => {
  const { origin, options } = await fixture((_request, response) =>
    response
      .writeHead(101, { Connection: 'Upgrade', Upgrade: 'websocket' })
      .end(),
  );
  await expect(requestAllowedOrigin(origin, options)).rejects.toThrow(
    /upgrades/,
  );
});
it('rejects unsupported proxy protocols without leaking configured credentials or falling back to direct contact', async () => {
  let requests = 0;
  const { origin, options } = await fixture((_request, response) => {
    requests++;
    response.end();
  });
  for (const name of ['HTTP_PROXY', 'http_proxy'])
    vi.stubEnv(name, 'socks5://fixture:private-proxy-secret@127.0.0.1:9');
  for (const name of ['NO_PROXY', 'no_proxy']) vi.stubEnv(name, '');
  const result = requestAllowedOrigin(origin, options);
  await expect(result).rejects.toThrow(/proxy configuration/);
  await expect(result).rejects.not.toThrow('private-proxy-secret');
  expect(requests).toBe(0);
});
it('cancels slow exchanges and does not expose caller abort reasons', async () => {
  const { origin, options } = await fixture(() => {});
  await expect(
    requestAllowedOrigin(origin, { ...options, timeoutMs: 20 }),
  ).rejects.toThrow(/timed out/);
  const controller = new AbortController();
  const request = requestAllowedOrigin(origin, {
    ...options,
    signal: controller.signal,
  });
  controller.abort('private-abort-reason');
  await expect(request).rejects.toThrow(/cancelled/);
  await expect(request).rejects.not.toThrow('private');
  await expect(
    abortableOutbound(
      Promise.reject(new Error('later worker result')),
      AbortSignal.abort(),
    ),
  ).rejects.toThrow(/cancelled/);
});
