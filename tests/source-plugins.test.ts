import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  checkProjectPluginConformance,
  compileProject,
} from '@davidniessen/doctopus-compiler';
import {
  runSourcePluginFiles,
  checkSourcePluginConformance,
  definePlugin,
} from '@davidniessen/doctopus-plugin-sdk';
import { buildSite } from '@davidniessen/doctopus-cli';
import type { SpecSource } from '@davidniessen/doctopus-plugin-sdk';

const document = {
  openapi: '3.1.0',
  info: { title: 'Source fixture', version: 'v1' },
  paths: {},
};
const source: SpecSource = {
  id: 'api',
  path: 'openapi.json',
  content: JSON.stringify(document),
};
const plugin = (loadSpec: string, extra = '') =>
  `export default { name: 'source-test', version: '1.0.0', pluginApi: '1', capabilities: ['source'], ${extra} loadSpec: ${loadSpec} };`;
async function fixture(code: string, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-source-plugin-'));
  try {
    await writeFile(join(root, 'plugin.mjs'), code);
    await writeFile(join(root, 'openapi.json'), source.content);
    await writeFile(
      join(root, 'docs.config.yaml'),
      'name: Source fixture\nspecs:\n  - id: api\n    path: openapi.json\nplugins:\n  - plugin.mjs\n',
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('trusted spec source hooks', () => {
  it('requires the explicit source capability', () => {
    expect(() =>
      definePlugin({
        name: 'source',
        version: '1.0.0',
        pluginApi: '1',
        loadSpec: (source) => source.content,
      }),
    ).toThrow();
    expect(
      definePlugin({
        name: 'source',
        version: '1.0.0',
        pluginApi: '1',
        capabilities: ['source', 'theme', 'transform'],
        loadSpec: (source) => source.content,
        theme: () => ({}),
        transform: (site) => site,
      }),
    ).toBeDefined();
  });
  it('preserves identity and caller data while composing sources in configuration order', async () => {
    await fixture(
      plugin(
        '(source, { diagnostic }) => { source.path = "changed.json"; diagnostic({ code: "source", severity: "warning", message: "Applied" }); return source.content.replace("Source fixture", "First"); }',
      ),
      async (root) => {
        await writeFile(
          join(root, 'second.mjs'),
          plugin(
            '(source) => source.content.replace("First", "Second")',
          ).replace("name: 'source-test'", "name: 'source-second'"),
        );
        const original = structuredClone(source);
        const result = await checkSourcePluginConformance(
          root,
          ['plugin.mjs', 'second.mjs'],
          [source],
        );
        expect(result.sources[0]).toMatchObject({
          id: 'api',
          path: 'openapi.json',
        });
        expect(JSON.parse(result.sources[0]!.content).info.title).toBe(
          'Second',
        );
        expect(result.diagnostics).toEqual([
          { code: 'source', severity: 'warning', message: 'Applied' },
        ]);
        expect(source).toEqual(original);
      },
    );
  });
  it('normalizes hook output, resolves local references at the original path and runs theme/graph afterward', async () => {
    await fixture(
      `export default { name: 'combined', version: '1.0.0', pluginApi: '1', capabilities: ['source', 'theme', 'transform'], loadSpec: (source) => source.content.replace('Source fixture', 'Loaded source'), theme: () => ({ radius: 12 }), transform(site) { if (site.apis[0].title !== 'Loaded source' || site.config.theme.radius !== 12) throw new Error('Hook order'); site.config.name = 'Complete pipeline'; return site; } };`,
      async (root) => {
        await writeFile(
          join(root, 'schema.json'),
          '{"type":"object","properties":{"id":{"type":"string"}}}',
        );
        await writeFile(
          join(root, 'openapi.json'),
          JSON.stringify({
            ...document,
            components: { schemas: { Item: { $ref: './schema.json' } } },
          }),
        );
        const built = await checkProjectPluginConformance(root, ['plugin.mjs']);
        expect(built.config.name).toBe('Complete pipeline');
        expect(built.apis[0]!.schemas.Item).toMatchObject({
          type: 'object',
          properties: { id: { type: 'string' } },
        });
        expect(built.pluginVersions).toHaveLength(1);
      },
    );
  });
  it('can adapt a non-OpenAPI JSON wrapper before structural validation, with explicit trust', async () => {
    await fixture(
      plugin('(source) => JSON.stringify(JSON.parse(source.content).payload)'),
      async (root) => {
        await writeFile(
          join(root, 'openapi.json'),
          JSON.stringify({ payload: document }),
        );
        await expect(compileProject(root)).rejects.toThrow(/trust-plugins/);
        expect(
          (
            await compileProject(root, 'docs.config.yaml', {
              trustPlugins: true,
            })
          ).apis[0]!.title,
        ).toBe('Source fixture');
        const check = spawnSync(
          process.execPath,
          [
            resolve('packages/cli/dist/main.js'),
            'plugin-check',
            'plugin.mjs',
            root,
            '--trust-plugins',
          ],
          { encoding: 'utf8' },
        );
        expect(check.status, check.stderr).toBe(0);
        expect(check.stdout).toContain('Plugin conformance passed');
      },
    );
  });
  it('supports YAML source text without a JSON round-trip', async () => {
    await fixture(
      plugin(
        '(source) => source.content.replace("YAML fixture", "YAML source hook")',
      ),
      async (root) => {
        const input = {
          ...source,
          path: 'openapi.yaml',
          content:
            'openapi: 3.1.0\ninfo:\n  title: YAML fixture\n  version: v1\npaths: {}\n',
        };
        const result = await runSourcePluginFiles(
          root,
          ['plugin.mjs'],
          [input],
        );
        expect(result.sources[0]!.content).toContain('title: YAML source hook');
        await writeFile(join(root, 'openapi.json'), input.content);
        expect(
          (
            await compileProject(root, 'docs.config.yaml', {
              trustPlugins: true,
            })
          ).apis[0]!.title,
        ).toBe('YAML source hook');
      },
    );
  });
  it.each([
    'null',
    '({ content: source.content })',
    '"x".repeat(16 * 1024 * 1024 + 1)',
  ])('rejects invalid or oversized source output (%s)', async (output) => {
    await fixture(plugin(`(source) => ${output}`), async (root) => {
      await expect(
        runSourcePluginFiles(root, ['plugin.mjs'], [source]),
      ).rejects.toThrow(/worker failed/);
    });
  });
  it.each(['() => { while (true) {} }', '() => new Promise(() => {})'])(
    'terminates unresponsive source hooks (%s)',
    async (load) => {
      await fixture(plugin(load), async (root) => {
        await expect(
          runSourcePluginFiles(root, ['plugin.mjs'], [source], {
            timeoutMs: 300,
          }),
        ).rejects.toThrow(/execution limit/);
      });
    },
  );
  it('detects nondeterminism in both source-only and complete project conformance', async () => {
    await fixture(
      plugin(
        '(source) => source.content.replace("Source fixture", String(Math.random()))',
      ),
      async (root) => {
        await expect(
          checkSourcePluginConformance(root, ['plugin.mjs'], [source]),
        ).rejects.toThrow(/differs/);
        await expect(
          checkProjectPluginConformance(root, ['plugin.mjs']),
        ).rejects.toThrow(/differs/);
      },
    );
  });
  it('does not resolve remote or escaped references introduced by source hooks, and preserves prior output', async () => {
    await fixture(plugin('(source) => source.content'), async (root) => {
      const first = await buildSite(root, { trustPlugins: true });
      const manifest = await readFile(
        join(first.directory, 'manifest.json'),
        'utf8',
      );
      await symlink('/etc/hosts', join(root, 'escaped.json'));
      for (const reference of [
        'https://example.invalid/schema.json',
        './escaped.json',
      ]) {
        const output = JSON.stringify({
          ...document,
          components: { schemas: { Item: { $ref: reference } } },
        });
        await writeFile(
          join(root, 'plugin.mjs'),
          plugin(`() => ${JSON.stringify(output)}`),
        );
        await expect(buildSite(root, { trustPlugins: true })).rejects.toThrow();
        expect(
          await readFile(join(first.directory, 'manifest.json'), 'utf8'),
        ).toBe(manifest);
      }
      await writeFile(join(root, 'plugin.mjs'), plugin('() => "not OpenAPI"'));
      await expect(buildSite(root, { trustPlugins: true })).rejects.toThrow(
        /supported versions/,
      );
      expect(
        await readFile(join(first.directory, 'manifest.json'), 'utf8'),
      ).toBe(manifest);
    });
  });
  it('rejects a source document changed during plugin execution', async () => {
    await fixture(
      `import { writeFileSync } from 'node:fs'; ${plugin('(source) => { writeFileSync("openapi.json", "changed"); return source.content; }')}`,
      async (root) => {
        await expect(
          compileProject(root, 'docs.config.yaml', { trustPlugins: true }),
        ).rejects.toThrow(/Spec input changed/);
      },
    );
  });
  it('rejects declared inputs changed between source and graph stages', async () => {
    await fixture(
      `import { readFileSync, writeFileSync } from 'node:fs'; if (readFileSync('stage.txt', 'utf8') === 'source') writeFileSync('brand.json', '{"radius":14}'); ${plugin('(source) => { writeFileSync("stage.txt", "source"); return source.content; }', 'inputs: ["brand.json"],')}`,
      async (root) => {
        await writeFile(join(root, 'stage.txt'), 'initial');
        await writeFile(join(root, 'brand.json'), '{"radius":12}');
        await expect(
          compileProject(root, 'docs.config.yaml', { trustPlugins: true }),
        ).rejects.toThrow(/between source and graph/);
      },
    );
  });
  it('runs the first-party source example through complete project conformance', async () => {
    const site = await checkProjectPluginConformance(
      resolve('examples/source-plugin'),
      ['deployment.mjs'],
    );
    expect(site.apis[0]!.servers).toEqual(['https://api.example.com/v1']);
    expect(site.diagnostics).toContainEqual({
      code: 'deployment-source',
      severity: 'warning',
      message: 'Applied the reviewed deployment server list.',
      source: 'openapi.json',
    });
    expect(site.pluginVersions![0]!.inputs!.map((input) => input.path)).toEqual(
      ['deployment.json', 'deployment.mjs'],
    );
  });
});
