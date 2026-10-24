import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  compileProject,
  checkProjectPluginConformance,
} from '@davidniessen/doctopus-compiler';
import {
  applyPlugins,
  runPluginFiles,
  definePlugin,
} from '@davidniessen/doctopus-plugin-sdk';
import type { SiteData } from '@davidniessen/doctopus-contracts';
let site: SiteData;
beforeAll(async () => {
  site = await compileProject(resolve('examples/demo'));
});
const sample = {
  id: 'custom',
  label: 'Custom SDK',
  language: 'typescript',
  code: 'await client.get();',
};
async function fixture(code: string, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-snippet-plugin-'));
  try {
    await writeFile(join(root, 'plugin.mjs'), code);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const plugin = (generate: string) =>
  `export default { name: 'snippets', version: '1.0.0', pluginApi: '1', capabilities: ['snippets'], generateSnippets: ${generate} };`;

describe('reviewed build-time snippet plugins', () => {
  it('requires the explicit snippet capability', () => {
    expect(() =>
      definePlugin({
        name: 'snippets',
        version: '1.0.0',
        pluginApi: '1',
        generateSnippets: () => [],
      }),
    ).toThrow();
    expect(
      definePlugin({
        name: 'snippets',
        version: '1.0.0',
        pluginApi: '1',
        capabilities: ['source', 'theme', 'transform', 'snippets'],
        generateSnippets: () => [],
      }),
    ).toBeDefined();
  });
  it('generates from the final graph, namespaces identities and isolates input mutations', async () => {
    const original = structuredClone(site);
    const result = await applyPlugins(site, [
      {
        name: 'first',
        version: '1.0.0',
        pluginApi: '1',
        capabilities: ['snippets'],
        generateSnippets({ api, operation }, { diagnostic }) {
          expect(operation.summary).toBe('Final operation');
          expect(api.title).toBe('Final API');
          expect(() => {
            (api as { title: string }).title = 'Ignored mutation';
          }).toThrow(TypeError);
          operation.path = '/ignored';
          diagnostic({
            code: 'sample',
            severity: 'warning',
            message: 'Generated reviewed sample',
          });
          return [sample];
        },
      },
      {
        name: 'last-transform',
        version: '1.0.0',
        pluginApi: '1',
        transform(graph) {
          for (const api of graph.apis) {
            api.title = 'Final API';
            for (const operation of api.operations)
              operation.summary = 'Final operation';
          }
          return graph;
        },
      },
      {
        name: 'second',
        version: '1.0.0',
        pluginApi: '1',
        capabilities: ['snippets'],
        generateSnippets: () => [sample],
      },
    ]);
    expect(result.apis[0]!.operations[0]!.codeSamples).toEqual([
      { ...sample, plugin: 'first' },
      { ...sample, plugin: 'second' },
    ]);
    expect(result.apis[0]!.title).toBe('Final API');
    expect(result.apis[0]!.operations[0]!.path).toBe(
      original.apis[0]!.operations[0]!.path,
    );
    expect(result.diagnostics.some((item) => item.code === 'sample')).toBe(
      true,
    );
    expect(site).toEqual(original);
  });
  it.each([
    'null',
    '[{id:"bad", label:"Invalid", language:"js", code:"", extra:true}]',
    '[{id:"bad", label:"Invalid", language:"js", code:"x".repeat(256 * 1024 + 1)}]',
    '[{id:"bad", label:"Invalid", language:"js", code:"🌍".repeat(70_000)}]',
    `[${JSON.stringify(sample)},${JSON.stringify(sample)}]`,
    `Array.from({length:9}, (_, i) => ({...${JSON.stringify(sample)}, id:'sample-'+i}))`,
  ])('rejects invalid, duplicate or excessive samples (%s)', async (output) => {
    await fixture(plugin(`() => (${output})`), async (root) => {
      await expect(runPluginFiles(root, ['plugin.mjs'], site)).rejects.toThrow(
        /worker failed/,
      );
    });
  });
  it('enforces aggregate generated-code limits', async () => {
    const input = structuredClone(site);
    input.apis = [input.apis[0]!];
    const operation = input.apis[0]!.operations[0]!;
    input.apis[0]!.operations = Array.from({ length: 65 }, (_, i) => ({
      ...operation,
      id: `operation-${i}`,
      slug: `operation-${i}`,
    }));
    await fixture(
      plugin(
        `() => [{...${JSON.stringify(sample)}, code:'x'.repeat(256 * 1024)}]`,
      ),
      async (root) => {
        await expect(
          runPluginFiles(root, ['plugin.mjs'], input),
        ).rejects.toThrow(/worker failed/);
      },
    );
  });
  it.each(['() => { while (true) {} }', '() => new Promise(() => {})'])(
    'terminates an unresponsive generator (%s)',
    async (generate) => {
      await fixture(plugin(generate), async (root) => {
        await expect(
          runPluginFiles(root, ['plugin.mjs'], site, { timeoutMs: 300 }),
        ).rejects.toThrow(/execution limit/);
      });
    },
  );
  it('builds the Go example using public SDK inputs, fingerprints helpers and redacts sensitive JSON fields', async () => {
    const root = resolve('examples/snippet-plugin');
    const checked = await checkProjectPluginConformance(root, ['go.mjs']);
    const code = checked.apis[0]!.operations[0]!.codeSamples![0]!;
    expect(code).toMatchObject({
      plugin: '@davidniessen/example-go-snippets',
      id: 'go-http',
      label: 'Go net/http',
      language: 'go',
    });
    expect(code.code).toContain('https://api.example.com/projects/project-123');
    expect(
      checked.pluginVersions![0]!.inputs!.map((input) => input.path),
    ).toEqual(['go-code.mjs', 'go.mjs']);
    const input = structuredClone(checked);
    const operation = input.apis[0]!.operations[0]!;
    delete operation.codeSamples;
    operation.method = 'post';
    operation.requestBody = {
      required: true,
      description: '',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              secret: { type: 'string', writeOnly: true },
              visible: { type: 'string' },
            },
          },
          example: {
            secret: 'private-example-marker',
            visible: 'visible-marker',
          },
        },
      },
    };
    const redacted = await runPluginFiles(root, ['go.mjs'], input);
    expect(
      redacted.site.apis[0]!.operations[0]!.codeSamples![0]!.code,
    ).not.toContain('private-example-marker');
    expect(
      redacted.site.apis[0]!.operations[0]!.codeSamples![0]!.code,
    ).toContain('visible-marker');
    operation.requestBody.content = { 'multipart/form-data': { schema: {} } };
    const skipped = await runPluginFiles(root, ['go.mjs'], input);
    expect(skipped.site.apis[0]!.operations[0]!.codeSamples).toBeUndefined();
  });
});
