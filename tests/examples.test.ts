import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { checkExamples, loadSpec } from '@davidniessen/doctopus-spec';
import type { Schema } from '@davidniessen/doctopus-contracts';

async function fixture(
  schema: Schema | boolean,
  value: unknown,
  run: (root: string) => Promise<void>,
  options: { version?: string; components?: unknown; mediaType?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-examples-'));
  try {
    const document = {
      openapi: options.version ?? '3.1.0',
      info: { title: 'Examples', version: 'v1' },
      paths: {
        '/values': {
          post: {
            description: 'Validate values.',
            requestBody: {
              content: {
                [options.mediaType ?? 'application/json']: {
                  schema,
                  example: value,
                },
              },
            },
            responses: { 200: { description: 'OK' } },
          },
        },
      },
      ...(options.components ? { components: options.components } : {}),
    };
    await writeFile(join(root, 'openapi.json'), JSON.stringify(document));
    await writeFile(
      join(root, 'docs.config.yaml'),
      'name: Example check\nspecs:\n  - id: api\n    path: openapi.json\n',
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const load = (root: string) =>
  loadSpec(root, { id: 'test', path: 'openapi.json' });
describe('offline authored example validation', () => {
  it.each([
    'application/xml',
    'application/x-www-form-urlencoded',
    'application/octet-stream',
  ])(
    'reports serialized %s examples for review instead of falsely rejecting them as JSON objects',
    async (mediaType) => {
      await fixture(
        { type: 'object', properties: { name: { type: 'string' } } },
        'sensitive-serialized-marker',
        async (root) => {
          const diagnostics = await checkExamples(await load(root));
          expect(diagnostics).toEqual([
            expect.objectContaining({
              code: 'example-serialization-unsupported',
              severity: 'warning',
            }),
          ]);
          expect(JSON.stringify(diagnostics)).not.toContain(
            'sensitive-serialized-marker',
          );
        },
        { mediaType },
      );
    },
  );
  it('checks logical values for non-JSON media while explicitly leaving serialization unverified', async () => {
    await fixture(
      { type: 'object', required: ['name'] },
      {},
      async (root) => {
        const diagnostics = await checkExamples(await load(root));
        expect(diagnostics).toContainEqual(
          expect.objectContaining({ code: 'invalid-example' }),
        );
        expect(diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'example-serialization-unsupported',
          }),
        );
      },
      { mediaType: 'application/xml' },
    );
  });
  it('validates raw text strings and JSON media without trimming or implicit JSON decoding', async () => {
    await fixture(
      { type: 'string', minLength: 5 },
      '  a  ',
      async (root) => {
        expect(await checkExamples(await load(root))).toEqual([]);
      },
      { mediaType: 'text/plain; charset=utf-8' },
    );
    await fixture(
      { type: 'string', minLength: 2 },
      '',
      async (root) => {
        expect(await checkExamples(await load(root))).toContainEqual(
          expect.objectContaining({ code: 'invalid-example' }),
        );
      },
      { mediaType: 'text/plain' },
    );
    await fixture(
      { type: 'object' },
      '{"name":"value"}',
      async (root) => {
        expect(await checkExamples(await load(root))).toContainEqual(
          expect.objectContaining({ code: 'invalid-example' }),
        );
      },
      { mediaType: 'application/problem+json; charset=utf-8' },
    );
  });
  it.each([
    [{ type: 'boolean' }, false],
    [{ type: 'integer', minimum: 0 }, 0],
    [{ type: 'string' }, ''],
    [{ type: ['string', 'null'] }, null],
    [{ type: 'string', format: 'date-time' }, '2026-10-22T12:00:00Z'],
    [true, { anything: true }],
  ] as const)(
    'accepts falsy and typed valid examples (%j)',
    async (schema, value) => {
      await fixture(schema, value, async (root) => {
        expect(await checkExamples(await load(root))).toEqual([]);
      });
    },
  );
  it('flags invalid examples without printing the authored credential value', async () => {
    await fixture(
      { type: 'integer' },
      'sensitive-authored-value-marker',
      async (root) => {
        const diagnostics = await checkExamples(await load(root));
        expect(diagnostics).toEqual([
          expect.objectContaining({
            code: 'invalid-example',
            severity: 'error',
            source: expect.stringContaining(
              '/requestBody/content/application/json/example',
            ),
          }),
        ]);
        expect(JSON.stringify(diagnostics)).not.toContain(
          'sensitive-authored-value-marker',
        );
      },
    );
  });
  it('validates standard formats and boolean-false schemas', async () => {
    await fixture(
      { type: 'string', format: 'email' },
      'invalid-email',
      async (root) => {
        expect(await checkExamples(await load(root))).toContainEqual(
          expect.objectContaining({ code: 'invalid-example' }),
        );
      },
    );
    await fixture(false, null, async (root) => {
      expect(await checkExamples(await load(root))).toContainEqual(
        expect.objectContaining({ code: 'invalid-example' }),
      );
    });
  });
  it('resolves recursive and composed schemas while preserving request/response visibility', async () => {
    await fixture(
      { $ref: '#/components/schemas/Pet' },
      {
        name: 'Luna',
        password: 'request-only',
        child: { name: 'Junior', password: 'request-only' },
      },
      async (root) => {
        const api = await load(root);
        expect(await checkExamples(api)).toEqual([]);
        const operation = api.operations[0]!;
        operation.responses[0]!.content['application/json'] = {
          schema: { $ref: '#/components/schemas/Pet' },
          example: { id: '1', name: 'Luna' },
        };
        // writeOnly password is optional in a response; readOnly id remains required.
        expect(await checkExamples(api)).toEqual([]);
        operation.responses[0]!.content['application/json']!.example = {
          name: 'Luna',
        };
        expect(await checkExamples(api)).toContainEqual(
          expect.objectContaining({
            code: 'invalid-example',
            source: expect.stringContaining('/responses/200/'),
          }),
        );
      },
      {
        components: {
          schemas: {
            Pet: {
              type: 'object',
              required: ['id', 'name', 'password'],
              properties: {
                id: { type: 'string', readOnly: true },
                name: { type: 'string' },
                child: { $ref: '#/components/schemas/Pet' },
                password: { type: 'string', writeOnly: true },
              },
            },
          },
        },
      },
    );
    await fixture(
      { allOf: [{ type: 'integer' }, { minimum: 1 }] },
      0,
      async (root) => {
        expect(await checkExamples(await load(root))).toContainEqual(
          expect.objectContaining({ code: 'invalid-example' }),
        );
      },
    );
  });
  it('applies OpenAPI 3.0 nullable/exclusive semantics and retains 3.1 reference siblings', async () => {
    await fixture(
      { type: 'string', nullable: true },
      null,
      async (root) => {
        expect(await checkExamples(await load(root))).toEqual([]);
      },
      { version: '3.0.4' },
    );
    await fixture(
      { type: 'number', minimum: 0, exclusiveMinimum: true },
      0,
      async (root) => {
        expect(await checkExamples(await load(root))).toContainEqual(
          expect.objectContaining({ code: 'invalid-example' }),
        );
      },
      { version: '3.0.4' },
    );
    await fixture(
      { $ref: '#/components/schemas/Text', minLength: 5 },
      'a',
      async (root) => {
        expect(await checkExamples(await load(root))).toContainEqual(
          expect.objectContaining({ code: 'invalid-example' }),
        );
      },
      { components: { schemas: { Text: { type: 'string' } } } },
    );
  });
  it('checks named parameters, media, nested schema examples and headers, without fetching external values', async () => {
    await fixture(
      { type: 'integer', example: 'invalid-nested' },
      1,
      async (root) => {
        const document = JSON.parse(
          await import('node:fs/promises').then((fs) =>
            fs.readFile(join(root, 'openapi.json'), 'utf8'),
          ),
        );
        const op = document.paths['/values'].post;
        op.parameters = [
          {
            in: 'query',
            name: 'count',
            schema: { type: 'integer' },
            examples: { bad: { value: 'invalid-count' } },
          },
        ];
        op.responses['200'].headers = {
          'X-Limit': {
            schema: { type: 'integer' },
            examples: { bad: { $ref: '#/components/examples/Bad' } },
          },
        };
        delete op.requestBody.content['application/json'].example;
        op.requestBody.content['application/json'].examples = {
          remote: {
            externalValue: 'https://never-fetch.example.invalid/example.json',
          },
          good: { value: 1 },
        };
        document.components = {
          examples: { Bad: { value: 'invalid-header' } },
        };
        await writeFile(join(root, 'openapi.json'), JSON.stringify(document));
        const diagnostics = await checkExamples(await load(root));
        expect(
          diagnostics.filter((d) => d.code === 'invalid-example'),
        ).toHaveLength(3);
        expect(diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'external-example',
            severity: 'warning',
          }),
        );
      },
    );
  });
  it('warns when validation cannot enforce a custom keyword or format', async () => {
    await fixture(
      { type: 'string', format: 'company-id', companyConstraint: 'special' },
      'anything',
      async (root) => {
        const diagnostics = await checkExamples(await load(root));
        expect(diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'example-schema-unsupported',
            message: expect.stringContaining('company-id'),
          }),
        );
        expect(diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'example-schema-unsupported',
            message: expect.stringContaining('companyConstraint'),
          }),
        );
      },
    );
  });
  it('terminates catastrophic regex validation externally', async () => {
    await fixture(
      { type: 'string', pattern: '^(a+)+$' },
      `${'a'.repeat(100_000)}X`,
      async (root) => {
        await expect(
          checkExamples(await load(root), { timeoutMs: 400 }),
        ).rejects.toThrow(/execution limit/);
      },
    );
  });
  it('makes doctor fail invalid examples while validate remains a structural check', async () => {
    await fixture({ type: 'integer' }, 'invalid', async (root) => {
      const cli = (mode: string) =>
        spawnSync(
          process.execPath,
          [resolve('packages/cli/dist/main.js'), mode, root, '--json'],
          { encoding: 'utf8', timeout: 15_000 },
        );
      expect(cli('validate').status).toBe(0);
      const doctor = cli('doctor');
      expect(doctor.status, doctor.stderr).toBe(1);
      expect(JSON.parse(doctor.stdout)).toContainEqual(
        expect.objectContaining({ code: 'invalid-example' }),
      );
    });
  });
});
