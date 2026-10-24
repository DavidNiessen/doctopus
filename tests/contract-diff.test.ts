import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { diffApi, loadSpec } from '@davidniessen/doctopus-spec';
import type {
  ApiDocument,
  Operation,
  Schema,
} from '@davidniessen/doctopus-contracts';

function api(
  schema: Schema = { type: 'string' },
  direction: 'request' | 'response' = 'request',
): ApiDocument {
  const content = { 'application/json': { schema } };
  return {
    id: 'test',
    version: 'v1',
    title: 'Test',
    description: '',
    source: 'openapi.json',
    servers: [],
    schemas: {},
    securitySchemes: {},
    diagnostics: [],
    operations: [
      {
        id: 'createPet',
        slug: 'createpet',
        kind: 'endpoint',
        path: '/pets',
        method: 'post',
        summary: 'Create pet',
        description: '',
        tags: [],
        deprecated: false,
        parameters: [],
        security: [],
        servers: ['https://api.example.test'],
        source: '#/paths/pets/post',
        ...(direction === 'request'
          ? { requestBody: { required: false, description: '', content } }
          : {}),
        responses: [
          {
            status: '200',
            description: 'OK',
            headers: {},
            content: direction === 'response' ? content : {},
          },
        ],
      },
    ],
  };
}
function severities(a: Schema, b: Schema, direction: 'request' | 'response') {
  return diffApi(api(a, direction), api(b, direction)).map(
    (change) => change.severity,
  );
}
const operation = (document: ApiDocument): Operation => document.operations[0]!;

describe('conservative API contract classification', () => {
  it.each(['description', 'title', 'default', 'examples', 'deprecated'])(
    'keeps a security scheme named %s in authentication changes',
    (name) => {
      const old = api();
      old.securitySchemes[name] = { type: 'http', scheme: 'bearer' };
      operation(old).security = [{ [name]: [] }];
      const next = structuredClone(old);
      operation(next).security = [];
      expect(diffApi(old, next)).toEqual([
        expect.objectContaining({ code: 'security-changed', severity: 'info' }),
      ]);
    },
  );
  it('compares scope names while ignoring scope and scheme descriptions', () => {
    const old = api();
    old.securitySchemes.oauth = {
      type: 'oauth2',
      description: 'Old scheme text',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://auth.example.test/authorize',
          tokenUrl: 'https://auth.example.test/token',
          scopes: { description: 'Read records', default: 'Default access' },
        },
      },
    };
    operation(old).security = [{ oauth: ['description'] }];
    const next = structuredClone(old);
    next.securitySchemes.oauth!.description = 'New scheme text';
    const flow = next.securitySchemes.oauth!.flows!.authorizationCode as {
      scopes: Record<string, string>;
    };
    flow.scopes.description = 'Read all records';
    expect(diffApi(old, next)).toEqual([]);
    delete flow.scopes.description;
    expect(diffApi(old, next)).toEqual([
      expect.objectContaining({
        code: 'security-tightened',
        severity: 'breaking',
      }),
    ]);
  });
  it('uses each OpenAPI dialect for nullable changes and migrations', () => {
    const old = api({ type: 'string', nullable: true });
    old.openapiVersion = '3.1.0';
    const next = structuredClone(old);
    operation(next).requestBody!.content['application/json']!.schema = {
      type: 'string',
    };
    expect(diffApi(old, next)).toEqual([]);
    old.openapiVersion = '3.0.4';
    expect(diffApi(old, next)).toContainEqual(
      expect.objectContaining({ code: 'schema-type', severity: 'breaking' }),
    );
    operation(next).requestBody!.content['application/json']!.schema = {
      type: ['string', 'null'],
    };
    expect(diffApi(old, next)).toEqual([]);
  });
  it('ignores OpenAPI 3.0 reference siblings throughout alias chains', () => {
    const old = api({
      $ref: '#/components/schemas/Alias',
      type: 'integer',
      nullable: true,
    });
    old.openapiVersion = '3.0.4';
    old.schemas = {
      Alias: { $ref: '#/components/schemas/Value', minLength: 10 },
      Value: { type: 'string' },
    };
    const next = structuredClone(old);
    operation(next).requestBody!.content['application/json']!.schema = {
      type: 'string',
    };
    expect(diffApi(old, next)).toEqual([]);
  });
  it.each(['description', 'title', 'default', 'examples', 'deprecated'])(
    'compares the property named %s inside compositions as a schema, not an annotation',
    (name) => {
      const old = api({
        allOf: [{ type: 'object', properties: { [name]: { type: 'string' } } }],
      });
      const next = api({
        allOf: [
          { type: 'object', properties: { [name]: { type: 'integer' } } },
        ],
      });
      expect(diffApi(old, next)).toContainEqual(
        expect.objectContaining({ code: 'schema-review', severity: 'review' }),
      );
    },
  );
  it('keeps literal object fields meaningful while ignoring schema annotations', () => {
    expect(
      diffApi(
        api({ allOf: [{ const: { description: 'old' } }] }),
        api({ allOf: [{ const: { description: 'new' } }] }),
      ),
    ).toContainEqual(expect.objectContaining({ code: 'schema-review' }));
    expect(
      diffApi(
        api({ allOf: [{ type: 'string', description: 'old' }] }),
        api({ allOf: [{ type: 'string', description: 'new' }] }),
      ),
    ).toEqual([]);
    const old = api({ allOf: [{ type: 'string', nullable: true }] });
    const next = api({ allOf: [{ type: 'string', nullable: false }] });
    old.openapiVersion = next.openapiVersion = '3.1.0';
    expect(diffApi(old, next)).toEqual([]);
  });
  it.each(['request', 'response'] as const)(
    'resolves required visibility annotations for %s property references',
    (direction) => {
      const old = api(
        {
          type: 'object',
          properties: {
            id: { $ref: '#/components/schemas/Id', maxLength: 20 },
          },
        },
        direction,
      );
      old.openapiVersion = '3.1.0';
      old.schemas = {
        Id: {
          type: 'string',
          [direction === 'request' ? 'readOnly' : 'writeOnly']: true,
        },
      };
      const next = structuredClone(old);
      const schema =
        direction === 'request'
          ? operation(next).requestBody!.content['application/json']!.schema
          : operation(next).responses[0]!.content['application/json']!.schema;
      schema.required = ['id'];
      expect(diffApi(old, next)).toEqual([]);
      schema.properties = {};
      schema.required = [];
      expect(diffApi(old, next)).toEqual([]);
    },
  );
  it('retains explicit review boundaries for encoding and bounded schema depth', () => {
    const old = api();
    const next = structuredClone(old);
    operation(next).requestBody!.content['application/json']!.encoding = {
      payload: { contentType: 'text/plain' },
    };
    expect(diffApi(old, next)).toEqual([
      expect.objectContaining({ code: 'media-encoding', severity: 'review' }),
    ]);
    let nested: Schema = { type: 'string' };
    for (let i = 0; i < 66; i++) nested = { type: 'array', items: nested };
    expect(severities(nested, nested, 'request')).toContain('review');
  });
  it('applies opposite compatibility directions to request acceptance and response guarantees', () => {
    expect(
      severities({ type: 'number' }, { type: 'integer' }, 'request'),
    ).toEqual(['breaking']);
    expect(
      severities({ type: 'number' }, { type: 'integer' }, 'response'),
    ).toEqual(['info']);
    expect(
      severities({ type: 'integer' }, { type: 'number' }, 'request'),
    ).toEqual(['info']);
    expect(
      severities({ type: 'integer' }, { type: 'number' }, 'response'),
    ).toEqual(['breaking']);
    expect(
      severities({ type: 'string' }, { type: ['string', 'null'] }, 'response'),
    ).toEqual(['breaking']);
    expect(
      severities(
        { type: 'string', nullable: true },
        { type: ['string', 'null'] },
        'request',
      ),
    ).toEqual([]);
  });
  it('compares enum sets and const without treating ordering or duplicate members as changes', () => {
    expect(
      severities({ enum: ['a', 'b'] }, { enum: ['b', 'a', 'a'] }, 'request'),
    ).toEqual([]);
    expect(severities({ enum: [0, 1] }, { const: 0 }, 'request')).toEqual([
      'breaking',
    ]);
    expect(severities({ enum: [0, 1] }, { const: 0 }, 'response')).toEqual([
      'info',
    ]);
    expect(severities({ enum: ['a'] }, {}, 'response')).toEqual(['breaking']);
    expect(severities({}, { enum: ['a'] }, 'request')).toEqual(['breaking']);
  });
  it('finds nested required properties while respecting directional visibility', () => {
    const old = { type: 'object', properties: { id: { type: 'string' } } };
    const next = { ...old, required: ['id'] };
    expect(severities(old, next, 'request')).toEqual(['breaking']);
    expect(severities(next, old, 'response')).toEqual(['breaking']);
    const readOnly = {
      type: 'object',
      properties: { id: { type: 'string', readOnly: true } },
    };
    expect(
      severities(readOnly, { ...readOnly, required: ['id'] }, 'request'),
    ).toEqual([]);
    const writeOnly = {
      type: 'object',
      properties: { secret: { type: 'string', writeOnly: true } },
    };
    expect(
      severities(writeOnly, { ...writeOnly, required: ['secret'] }, 'response'),
    ).toEqual([]);
    expect(
      severities(
        { ...old, additionalProperties: false },
        { ...old, additionalProperties: true },
        'response',
      ),
    ).toEqual(['breaking']);
  });
  it('compares inclusive/exclusive bounds, zero, length and uniqueness', () => {
    expect(
      severities({ minimum: 0 }, { exclusiveMinimum: 0 }, 'request'),
    ).toEqual(['breaking']);
    expect(
      severities(
        { minimum: 0, exclusiveMinimum: true },
        { exclusiveMinimum: 0 },
        'request',
      ),
    ).toEqual([]);
    expect(
      severities({ exclusiveMaximum: 10 }, { maximum: 10 }, 'response'),
    ).toEqual(['breaking']);
    expect(
      severities(
        { maximum: 10 },
        { maximum: 20, exclusiveMaximum: 30 },
        'response',
      ),
    ).toEqual(['breaking']);
    expect(
      severities(
        {},
        { minLength: 1, maxLength: 10, uniqueItems: true },
        'request',
      ),
    ).toEqual(['breaking', 'breaking', 'breaking']);
  });
  it('resolves recursive and aliased components and classifies changed compositions for review', () => {
    const old = api({ $ref: '#/components/schemas/Pet' }, 'response');
    old.schemas.Pet = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parent: { $ref: '#/components/schemas/Pet' },
      },
    };
    const next = structuredClone(old);
    (next.schemas.Pet!.properties as Record<string, Schema>).name = {
      type: ['string', 'null'],
    };
    expect(diffApi(old, next)).toContainEqual(
      expect.objectContaining({ code: 'schema-type', severity: 'breaking' }),
    );
    expect(diffApi(old, structuredClone(old))).toEqual([]);
    const union = api({
      oneOf: [{ $ref: '#/components/schemas/Kind' }, { type: 'string' }],
    });
    union.schemas.Kind = { type: 'integer' };
    const changed = structuredClone(union);
    changed.schemas.Kind = { type: 'number' };
    expect(diffApi(union, changed)).toEqual([
      expect.objectContaining({
        code: 'schema-review',
        severity: 'review',
        location: '/requestBody/content/application~1json/schema/oneOf',
      }),
    ]);
    expect(diffApi(union, structuredClone(union))).toEqual([]);
  });
  it('requires review for unsupported constraint changes, without flagging description edits', () => {
    expect(
      severities(
        { type: 'string', description: 'old' },
        { type: 'string', description: 'new' },
        'request',
      ),
    ).toEqual([]);
    expect(severities({ pattern: '^a' }, { pattern: '^b' }, 'request')).toEqual(
      ['review'],
    );
    expect(
      severities({ format: 'email' }, { format: 'uri' }, 'response'),
    ).toEqual(['review']);
    expect(
      severities({}, { 'x-doctopus-boolean-schema': false }, 'request'),
    ).toEqual(['breaking']);
  });
  it('recognizes stricter AND/OR security, scopes, scheme changes and anonymous alternatives', () => {
    const old = api();
    old.securitySchemes = {
      oauth: { type: 'oauth2' },
      key: { type: 'apiKey', in: 'header', name: 'X-Key' },
    };
    operation(old).security = [{ oauth: ['read'] }, { key: [] }];
    const stricter = structuredClone(old);
    operation(stricter).security = [{ oauth: ['read', 'write'] }];
    expect(diffApi(old, stricter)).toEqual([
      expect.objectContaining({
        code: 'security-tightened',
        severity: 'breaking',
      }),
    ]);
    const relaxed = structuredClone(old);
    operation(relaxed).security.push({});
    expect(
      diffApi(old, relaxed).every((change) => change.severity === 'info'),
    ).toBe(true);
    const renamed = structuredClone(old);
    renamed.securitySchemes.key!.name = 'Authorization';
    expect(diffApi(old, renamed)).toContainEqual(
      expect.objectContaining({ code: 'security-tightened' }),
    );
    const publicApi = structuredClone(old);
    operation(publicApi).security = [];
    expect(diffApi(publicApi, old)).toContainEqual(
      expect.objectContaining({ code: 'security-tightened' }),
    );
  });
  it('normalizes header names and serialization defaults before comparing parameter contracts', () => {
    const old = api();
    operation(old).parameters = [
      {
        in: 'header',
        name: 'X-Id',
        required: false,
        description: '',
        schema: { type: 'string' },
      },
    ];
    const same = structuredClone(old);
    operation(same).parameters[0]!.name = 'x-id';
    operation(same).parameters[0]!.style = 'simple';
    operation(same).parameters[0]!.explode = false;
    expect(diffApi(old, same)).toEqual([]);
    operation(same).parameters[0]!.required = true;
    operation(same).parameters[0]!.explode = true;
    expect(diffApi(old, same).map((change) => change.code)).toEqual([
      'parameter-required',
      'parameter-serialization',
    ]);
  });
  it('reports removed response media/headers, required bodies, operation identities and migration references', () => {
    const old = api({ type: 'string' }, 'response');
    operation(old).responses[0]!.headers['X-RateLimit'] = {
      schema: { type: 'integer' },
    };
    const next = structuredClone(old);
    operation(next).responses[0]!.content = {};
    operation(next).responses[0]!.headers = {};
    operation(next).requestBody = {
      required: true,
      description: '',
      content: {},
    };
    operation(next).id = 'createAnimal';
    operation(next).externalDocs = {
      url: 'https://docs.example.test/migration',
    };
    const changes = diffApi(old, next);
    expect(changes.map((change) => change.code)).toEqual([
      'operation-id',
      'request-body-required',
      'media-removed',
      'response-header-removed',
    ]);
    expect(
      changes.every(
        (change) =>
          change.severity === 'breaking' &&
          change.referenceUrl?.endsWith('/migration'),
      ),
    ).toBe(true);
  });
  it('keeps callbacks separate from endpoints and reverses payload direction for incoming events', () => {
    const old = api({ type: 'integer' });
    const callback = structuredClone(operation(old));
    callback.kind = 'callback';
    callback.id = 'event';
    callback.callback = {
      operationId: 'subscribe',
      name: 'event',
      expression: '{$request.body#/url}',
    };
    old.operations.push(callback);
    const next = structuredClone(old);
    next.operations[1]!.requestBody!.content['application/json']!.schema = {
      type: 'number',
    };
    const changes = diffApi(old, next);
    expect(changes).toEqual([
      expect.objectContaining({
        operation: 'callback POST /pets',
        severity: 'breaking',
      }),
    ]);
    next.operations.pop();
    expect(diffApi(old, next)).toEqual([
      expect.objectContaining({
        operation: 'callback POST /pets',
        code: 'operation-removed',
      }),
    ]);
  });
  it('flags output additions that need client handling, while preserving deterministic output ordering', () => {
    const old = api();
    const next = structuredClone(old);
    operation(next).responses.push({
      status: '429',
      description: 'Rate limit',
      content: {},
      headers: {},
    });
    operation(next).deprecated = true;
    expect(diffApi(old, next).map((change) => change.severity)).toEqual([
      'info',
      'review',
    ]);
    expect(diffApi(old, next)).toEqual(diffApi(old, next));
  });
  it('loads real documents and enforces CLI breaking/review/allow-review exit codes and JSON shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-diff-'));
    try {
      const document = (pattern: string, required = false) => ({
        openapi: '3.1.0',
        info: { title: 'Diff', version: '1' },
        paths: {
          '/pets': {
            post: {
              requestBody: {
                required,
                content: {
                  'application/json': { schema: { type: 'string', pattern } },
                },
              },
              responses: { 200: { description: 'OK' } },
            },
          },
        },
      });
      const before = join(root, 'before.json'),
        after = join(root, 'after.json');
      await writeFile(before, JSON.stringify(document('^a')));
      await writeFile(after, JSON.stringify(document('^b')));
      expect(
        diffApi(
          await loadSpec(root, { id: 'api', path: 'before.json' }),
          await loadSpec(root, { id: 'api', path: 'after.json' }),
        ),
      ).toContainEqual(expect.objectContaining({ severity: 'review' }));
      const cli = (...args: string[]) =>
        spawnSync(
          process.execPath,
          [
            resolve('packages/cli/dist/main.js'),
            'diff',
            before,
            after,
            '--json',
            ...args,
          ],
          { encoding: 'utf8', timeout: 10_000 },
        );
      const review = cli();
      expect(review.status, review.stderr).toBe(2);
      expect(JSON.parse(review.stdout)).toEqual([
        expect.objectContaining({
          code: 'schema-review',
          location: '/requestBody/content/application~1json/schema/pattern',
        }),
      ]);
      expect(cli('--allow-review').status).toBe(0);
      await writeFile(after, JSON.stringify(document('^b', true)));
      expect(cli('--allow-review').status).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
