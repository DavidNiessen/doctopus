import { afterEach, expect, it, vi } from 'vitest';
import { parseConfig } from '@davidniessen/doctopus-spec';
import { isRelayEndpoint } from '@davidniessen/doctopus-contracts';
import {
  loadRelayPolicy,
  sendViaRelay,
} from '../apps/reader/src/relay-transport.js';
import type { ReaderRelayPolicy } from '../apps/reader/src/relay-transport.js';
import type { PreparedRequest } from '@davidniessen/doctopus-explorer';
const path = '/api/projects/gallery/relay';
const policy: ReaderRelayPolicy = {
  maxRequestBytes: 1024 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
  timeoutMs: 30_000,
  requestHeaders: ['Accept', 'Content-Type', 'Authorization'],
  destinations: [
    {
      origin: 'https://api.example.test',
      pathPrefix: '/v1/',
      methods: ['GET', 'HEAD', 'POST'],
    },
  ],
};
const request: PreparedRequest = {
  url: 'https://api.example.test/v1/items?key=target-query',
  method: 'POST',
  headers: {
    Authorization: 'Bearer target-secret',
    'Content-Type': 'application/json',
  },
  body: '{"name":"世界","id":9007199254740993}',
};
const signal = () => new AbortController().signal;
const response = (extra: Record<string, unknown> = {}) =>
  Response.json({
    schemaVersion: 1,
    status: 201,
    headers: { 'content-type': 'application/json' },
    bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
    ...extra,
  });
afterEach(() => vi.unstubAllGlobals());
it('requires an explicit same-origin relay endpoint without changing defaults', () => {
  const input = {
    name: 'Relay fixture',
    specs: [{ id: 'api', path: 'openapi.yaml' }],
  };
  expect(parseConfig(input).explorer?.relay).toBeUndefined();
  expect(
    parseConfig({ ...input, explorer: { relay: path } }).explorer?.relay,
  ).toBe(path);
  for (const relay of [
    'https://docs.example.test' + path,
    '//evil.test' + path,
    '/api/projects/x/relay?key=secret',
    '/api/projects/x/../relay',
    '/api/projects/x%2frelay/relay',
    '/api/projects/x/relay#hash',
    '/api/projects/X/relay',
    path + '/',
    '\\api\\projects\\x\\relay',
    '/api/projects/' + 'x'.repeat(64) + '/relay',
  ]) {
    expect(isRelayEndpoint(relay)).toBe(false);
    expect(() => parseConfig({ ...input, explorer: { relay } })).toThrow();
  }
});
it('checks access with same-origin session credentials and no target data', async () => {
  const transport = vi.fn(async () =>
    Response.json({ schemaVersion: 1, project: 'gallery', ...policy }),
  );
  vi.stubGlobal('fetch', transport);
  expect(await loadRelayPolicy(path, signal())).toEqual(policy);
  expect(transport.mock.calls[0]).toEqual([
    path,
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    }),
  ]);
});
it.each([401, 403, 429, 502])(
  'reports documentation relay failure %s without exposing its body',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('private-server-failure', { status })),
    );
    await expect(loadRelayPolicy(path, signal())).rejects.toThrow(
      /documentation server/,
    );
    await expect(
      sendViaRelay(path, policy, request, signal()),
    ).rejects.not.toThrow(/private-server/);
  },
);
it.each([
  { schemaVersion: 2 },
  { maxRequestBytes: 0 },
  { maxResponseBytes: 3 * 1024 * 1024 },
  { timeoutMs: 30001 },
  { requestHeaders: ['bad\nname'] },
  { destinations: [] },
  {
    destinations: [
      {
        origin: 'https://user:secret@example.test',
        pathPrefix: '/',
        methods: ['GET'],
      },
    ],
  },
  {
    destinations: [
      {
        origin: 'https://api.example.test',
        pathPrefix: '/',
        methods: ['TRACE'],
      },
    ],
  },
])('rejects invalid capabilities %#', async (extra) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ schemaVersion: 1, ...policy, ...extra })),
  );
  await expect(loadRelayPolicy(path, signal())).rejects.toThrow(
    /invalid or excessive/,
  );
});
it('preserves UTF-8 and precise request bytes, envelopes target credentials, and restores target status', async () => {
  const transport = vi.fn(async () => response());
  vi.stubGlobal('fetch', transport);
  const result = await sendViaRelay(path, policy, request, signal());
  expect(result.status).toBe(201);
  expect(result.headers.get('content-type')).toBe('application/json');
  expect(await result.text()).toBe('{"ok":true}');
  const [url, init] = transport.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe(path);
  expect(init).toMatchObject({
    credentials: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  const sent = JSON.parse(init.body as string);
  expect(sent).toEqual({
    url: request.url,
    method: 'POST',
    headers: [
      ['authorization', 'Bearer target-secret'],
      ['content-type', 'application/json'],
    ],
    bodyBase64: Buffer.from(request.body!).toString('base64'),
  });
  expect(JSON.stringify(init.headers)).not.toContain('target-secret');
});
it('serializes binary multipart bodies with the matching generated boundary', async () => {
  let sent: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return response();
    }),
  );
  await sendViaRelay(
    path,
    policy,
    {
      url: request.url,
      method: 'POST',
      headers: {},
      multipart: [
        {
          kind: 'file',
          name: 'upload',
          contentType: 'application/octet-stream',
          file: {
            filename: 'file.bin',
            data: new Blob([new Uint8Array([0, 255, 128])]),
          },
        },
      ],
    },
    signal(),
  );
  const type = (sent.headers as [string, string][]).find(
    ([name]) => name === 'content-type',
  )![1];
  const body = Buffer.from(sent.bodyBase64 as string, 'base64');
  expect(type).toMatch(/^multipart\/form-data; boundary=/);
  expect(body.includes(Buffer.from([0, 255, 128]))).toBe(true);
  expect(body.toString('latin1')).toContain('--' + type.split('boundary=')[1]);
});
it('rejects disallowed headers, methods, excessive UTF-8 and multipart bytes before contact', async () => {
  const transport = vi.fn();
  vi.stubGlobal('fetch', transport);
  await expect(
    sendViaRelay(path, policy, { ...request, method: 'TRACE' }, signal()),
  ).rejects.toThrow(/method/);
  await expect(
    sendViaRelay(
      path,
      policy,
      { ...request, headers: { 'X-Unknown': 'private' } },
      signal(),
    ),
  ).rejects.toThrow(/header/);
  await expect(
    sendViaRelay(
      path,
      { ...policy, maxRequestBytes: 5 },
      { ...request, body: '世界' },
      signal(),
    ),
  ).rejects.toThrow(/limit/);
  await expect(
    sendViaRelay(
      path,
      { ...policy, maxRequestBytes: 5 },
      {
        url: request.url,
        method: 'POST',
        headers: {},
        multipart: [
          {
            kind: 'file',
            name: 'upload',
            contentType: 'application/octet-stream',
            file: {
              filename: 'large.bin',
              data: new Blob(['more than five bytes']),
            },
          },
        ],
      },
      signal(),
    ),
  ).rejects.toThrow(/limit/);
  expect(transport).not.toHaveBeenCalled();
});
it.each([
  { schemaVersion: 2 },
  { status: 101 },
  { status: 302 },
  { headers: { 'set-cookie': 'secret' } },
  { bodyBase64: 'Zh==' },
  { bodyBase64: '%%%=' },
  { bodyBase64: 'a' },
  { status: 204 },
])('rejects invalid response envelopes %#', async (extra) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response(extra)),
  );
  await expect(sendViaRelay(path, policy, request, signal())).rejects.toThrow(
    /invalid or excessive/,
  );
});
it('rejects response bytes above the advertised limit', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      response({ bodyBase64: Buffer.from('12345').toString('base64') }),
    ),
  );
  await expect(
    sendViaRelay(path, { ...policy, maxResponseBytes: 4 }, request, signal()),
  ).rejects.toThrow(/invalid or excessive/);
});
it('distinguishes a target API authorization failure from documentation authorization', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ status: 401 })),
  );
  const result = await sendViaRelay(path, policy, request, signal());
  expect(result.status).toBe(401);
  expect(await result.text()).toBe('{"ok":true}');
});
it.each([204, 205, 304])('preserves bodyless status %s', async (status) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ status, bodyBase64: '' })),
  );
  const result = await sendViaRelay(path, policy, request, signal());
  expect(result.status).toBe(status);
  expect(result.body).toBeNull();
});
it('preserves HEAD metadata without a response body', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ bodyBase64: '' })),
  );
  expect(
    (
      await sendViaRelay(
        path,
        policy,
        { url: request.url, method: 'HEAD', headers: {} },
        signal(),
      )
    ).body,
  ).toBeNull();
});
it('bounds streamed envelopes and cancels their reader', async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(3 * 1024 * 1024));
            },
            cancel,
          }),
        ),
    ),
  );
  await expect(sendViaRelay(path, policy, request, signal())).rejects.toThrow(
    /excessive/,
  );
  expect(cancel).toHaveBeenCalled();
});
it('honors cancellation before serialization without contacting either server', async () => {
  const transport = vi.fn();
  vi.stubGlobal('fetch', transport);
  const controller = new AbortController();
  controller.abort();
  await expect(
    sendViaRelay(path, policy, request, controller.signal),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
