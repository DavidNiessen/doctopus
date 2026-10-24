import { beforeAll, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  writeFile,
  rm,
  symlink,
  mkdir,
  readFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileProject } from '@davidniessen/doctopus-compiler';
import { buildSite } from '@davidniessen/doctopus-cli';
import {
  runPluginFiles,
  checkPluginConformance,
  definePlugin,
  applyPlugins,
} from '@davidniessen/doctopus-plugin-sdk';
import { themePresets } from '@davidniessen/doctopus-contracts';
import type { SiteData } from '@davidniessen/doctopus-contracts';
let site: SiteData;
beforeAll(async () => {
  site = await compileProject(resolve('examples/demo'));
});
async function fixture(code: string, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-plugin-'));
  try {
    await writeFile(join(root, 'plugin.mjs'), code);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const plugin = (transform = '(site) => site', extra = '') =>
  `export default { name: '@example/test', version: '1.0.0', pluginApi: '1', ${extra} transform: ${transform} };`;
describe('trusted plugin process and conformance boundary', () => {
  it('requires explicit theme capability while preserving existing transform declarations', () => {
    const metadata = {
      name: 'theme',
      version: '1.0.0',
      pluginApi: '1' as const,
    };
    expect(() => definePlugin({ ...metadata, theme: () => ({}) })).toThrow();
    expect(() =>
      definePlugin({
        ...metadata,
        capabilities: ['theme'],
        transform: (site) => site,
      }),
    ).toThrow();
    expect(() =>
      definePlugin({ ...metadata, capabilities: ['theme', 'theme'] }),
    ).toThrow();
    expect(
      definePlugin({ ...metadata, transform: (site) => site }),
    ).toBeDefined();
  });
  it('composes theme tokens before transforms and subsequent plugins without mutating inputs', async () => {
    const original = structuredClone(site);
    const input = structuredClone(site);
    input.config.theme.colors = {
      light: { surface: '#ffffff', text: '#111111' },
      dark: { background: '#111111' },
    };
    const result = await applyPlugins(input, [
      {
        name: 'brand',
        version: '1.0.0',
        pluginApi: '1',
        capabilities: ['theme', 'transform'],
        theme(current, { diagnostic }) {
          // Even nested changes to the supplied snapshot cannot alter the source.
          current.colors!.dark!.background = '#222222';
          diagnostic({
            code: 'brand',
            severity: 'warning',
            message: 'Brand applied',
          });
          return {
            preset: 'ocean',
            radius: 12,
            colors: { light: { surface: '#fafafa' } },
          };
        },
        transform(current) {
          expect(current.config.theme.accent).toBe(themePresets.ocean);
          expect(current.config.theme.radius).toBe(12);
          return current;
        },
      },
      {
        name: 'spacing',
        version: '1.0.0',
        pluginApi: '1',
        capabilities: ['theme'],
        theme: (current) => ({ radius: current.radius + 1 }),
      },
    ]);
    expect(result.config.theme).toMatchObject({
      accent: themePresets.ocean,
      radius: 13,
      colors: {
        light: { surface: '#fafafa', text: '#111111' },
        dark: { background: '#111111' },
      },
    });
    expect(result.diagnostics).toContainEqual({
      code: 'brand',
      severity: 'warning',
      message: 'Brand applied',
    });
    expect(input.config.theme.radius).toBe(original.config.theme.radius);
    expect(input.config.theme.colors.light!.surface).toBe('#ffffff');
    expect(site).toEqual(original);
  });
  it.each([
    'null',
    '[]',
    '{ unexpected: true }',
    '{ colors: { sepia: {} } }',
    '{ colors: { light: [] } }',
  ])('rejects malformed theme-only worker output (%s)', async (output) => {
    await fixture(
      `export default { name: 'brand', version: '1.0.0', pluginApi: '1', capabilities: ['theme'], theme: () => (${output}) };`,
      async (root) => {
        await expect(
          runPluginFiles(root, ['plugin.mjs'], site),
        ).rejects.toThrow(/worker failed/);
      },
    );
  });
  it('terminates a non-cooperative theme-only hook', async () => {
    await fixture(
      `export default { name: 'brand', version: '1.0.0', pluginApi: '1', capabilities: ['theme'], theme() { while (true) {} } };`,
      async (root) => {
        await expect(
          runPluginFiles(root, ['plugin.mjs'], site, { timeoutMs: 300 }),
        ).rejects.toThrow(/execution limit/);
      },
    );
  });
  it('builds the theme example reproducibly and fingerprints its brand input', async () => {
    const root = resolve('examples/plugins');
    const baseline = await compileProject(root, 'docs.config.yaml', {
      skipPlugins: true,
    });
    const checked = await checkPluginConformance(
      root,
      ['brand-theme.mjs'],
      baseline,
    );
    expect(checked.site.config.theme).toMatchObject({
      accent: '#087f5b',
      radius: 12,
      colors: { light: { surface: '#f4f8f6' } },
    });
    expect(checked.plugins[0]!.inputs.map((input) => input.path)).toEqual([
      'brand-theme.mjs',
      'brand.json',
    ]);
    const built = await compileProject(root, 'docs.config.yaml', {
      trustPlugins: true,
    });
    expect(built.config.theme).toEqual(checked.site.config.theme);
    await fixture(
      `import { readFileSync } from 'node:fs'; export default { name: 'brand', version: '1.0.0', pluginApi: '1', inputs: ['brand.json'], capabilities: ['theme'], theme: () => JSON.parse(readFileSync('brand.json', 'utf8')) };`,
      async (directory) => {
        await writeFile(join(directory, 'brand.json'), '{"radius":12}');
        const first = await runPluginFiles(directory, ['plugin.mjs'], site);
        await writeFile(join(directory, 'brand.json'), '{"radius":14}');
        const second = await runPluginFiles(directory, ['plugin.mjs'], site);
        expect(first.plugins[0]!.sourceDigest).not.toBe(
          second.plugins[0]!.sourceDigest,
        );
        expect(second.site.config.theme.radius).toBe(14);
      },
    );
  });
  it('validates complete metadata and declared capabilities', () => {
    expect(() =>
      definePlugin({ name: 'test', version: '1.0.0trailing', pluginApi: '1' }),
    ).toThrow();
    expect(() =>
      definePlugin({
        name: 'test',
        version: '1.0.0',
        pluginApi: '1',
        capabilities: ['network'] as unknown as ['transform'],
      }),
    ).toThrow();
    expect(
      definePlugin({
        name: '@example/test',
        version: '1.2.3-beta.1+build',
        pluginApi: '1',
        inputs: ['helper.mjs'],
        capabilities: ['transform'],
      }).version,
    ).toContain('beta.1');
  });
  it('executes reproducibly without exposing plugin stdout/stderr or mutating caller data', async () => {
    const original = site.config.name;
    await fixture(
      plugin(
        '(site) => { console.log("plugin-log-marker"); console.error("plugin-error-marker"); site.config.name = "Transformed"; return site; }',
      ),
      async (root) => {
        const result = await checkPluginConformance(root, ['plugin.mjs'], site);
        expect(result.site.config.name).toBe('Transformed');
        expect(site.config.name).toBe(original);
        expect(result.plugins[0]).toMatchObject({
          name: '@example/test',
          version: '1.0.0',
          inputs: [
            {
              path: 'plugin.mjs',
              digest: expect.stringMatching(/^[a-f0-9]{64}$/),
            },
          ],
        });
      },
    );
  });
  it.each([
    '() => { while (true) { /* non-cooperative trusted code */ } }',
    '() => new Promise(() => {})',
  ])(
    'terminates unresponsive code using an external deadline (%s)',
    async (transform) => {
      await fixture(plugin(transform), async (root) => {
        await expect(
          runPluginFiles(root, ['plugin.mjs'], site, { timeoutMs: 300 }),
        ).rejects.toThrow(/execution limit/);
      });
    },
  );
  it.each([
    '(site) => { site.apis[0].operations[0].slug = "../../outside"; return site; }',
    '(site) => { site.guides.push(site.guides[0]); return site; }',
    '() => { throw new Error("sensitive-plugin-error-marker"); }',
  ])(
    'rejects malformed graph output and redacts arbitrary exceptions (%s)',
    async (transform) => {
      await fixture(plugin(transform), async (root) => {
        let failure: unknown;
        try {
          await runPluginFiles(root, ['plugin.mjs'], site);
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).not.toContain(
          'sensitive-plugin-error-marker',
        );
      });
    },
  );
  it('reloads transitive imports in fresh processes and fingerprints declared inputs', async () => {
    await fixture(
      `import { label } from './helper.mjs'; ${plugin('(site) => { site.config.name = label; return site; }', 'inputs: ["helper.mjs"],')}`,
      async (root) => {
        await writeFile(
          join(root, 'helper.mjs'),
          'export const label = "First";',
        );
        const first = await runPluginFiles(root, ['plugin.mjs'], site);
        await writeFile(
          join(root, 'helper.mjs'),
          'export const label = "Second";',
        );
        const second = await runPluginFiles(root, ['plugin.mjs'], site);
        expect(first.site.config.name).toBe('First');
        expect(second.site.config.name).toBe('Second');
        expect(first.plugins[0]!.sourceDigest).not.toBe(
          second.plugins[0]!.sourceDigest,
        );
        expect(second.plugins[0]!.inputs.map((input) => input.path)).toEqual([
          'helper.mjs',
          'plugin.mjs',
        ]);
      },
    );
  });
  it('rejects escaped entries and declared source inputs, including symlinks', async () => {
    await fixture(
      plugin('(site) => site', 'inputs: ["outside"],'),
      async (root) => {
        await symlink('/etc/hosts', join(root, 'outside'));
        await expect(runPluginFiles(root, ['outside'], site)).rejects.toThrow(
          /escapes/,
        );
        await expect(
          runPluginFiles(root, ['plugin.mjs'], site),
        ).rejects.toThrow(/worker failed/);
      },
    );
  });
  it('bounds output bytes and rejects declared files changed during execution', async () => {
    await fixture(
      plugin(
        '(site) => { site.config.description = "x".repeat(100_000); return site; }',
      ),
      async (root) => {
        await expect(
          runPluginFiles(root, ['plugin.mjs'], site, { maxBytes: 64 * 1024 }),
        ).rejects.toThrow(/worker failed|byte limit/);
      },
    );
    await fixture(
      `import { writeFileSync } from 'node:fs'; ${plugin('(site) => { writeFileSync("helper.mjs", "changed"); return site; }', 'inputs: ["helper.mjs"],')}`,
      async (root) => {
        await writeFile(join(root, 'helper.mjs'), 'original');
        await expect(
          runPluginFiles(root, ['plugin.mjs'], site),
        ).rejects.toThrow(/worker failed/);
      },
    );
  });
  it('detects nondeterminism rather than issuing a successful conformance report', async () => {
    await fixture(
      plugin(
        '(site) => { site.config.name = String(Math.random()); return site; }',
      ),
      async (root) => {
        await expect(
          checkPluginConformance(root, ['plugin.mjs'], site),
        ).rejects.toThrow(/differs/);
      },
    );
  });
  it('records fingerprints, sanitizes transformed guides, and preserves the prior build on invalid configuration', async () => {
    await fixture(
      plugin(
        '(site) => { site.guides[0].html = "<h2>Safe heading</h2><script>activeMarker()</script>"; return site; }',
      ),
      async (root) => {
        await mkdir(join(root, 'guides'));
        await writeFile(
          join(root, 'guides/introduction.md'),
          '# Hello\n\nExample.',
        );
        await writeFile(
          join(root, 'openapi.json'),
          JSON.stringify({
            openapi: '3.1.0',
            info: { title: 'Test', version: 'v1' },
            paths: {},
          }),
        );
        await writeFile(
          join(root, 'docs.config.yaml'),
          'name: Test\nspecs:\n  - id: api\n    path: openapi.json\nplugins:\n  - plugin.mjs\n',
        );
        await expect(compileProject(root)).rejects.toThrow(/trust-plugins/);
        const first = await buildSite(root, { trustPlugins: true });
        expect(first.site.guides[0]!.html).not.toContain('script');
        expect(first.manifest.plugins[0]!.sourceDigest).toMatch(
          /^[a-f0-9]{64}$/,
        );
        const manifest = await readFile(
          join(first.directory, 'manifest.json'),
          'utf8',
        );
        await writeFile(
          join(root, 'plugin.mjs'),
          plugin(
            '(site) => { site.config.basePath = "<script>"; return site; }',
          ),
        );
        await expect(buildSite(root, { trustPlugins: true })).rejects.toThrow(
          /plugin project configuration/,
        );
        expect(
          await readFile(join(first.directory, 'manifest.json'), 'utf8'),
        ).toBe(manifest);
        for (const theme of [
          '{ radius: 25 }',
          '{ colors: { light: { text: "#ffffff", background: "#ffffff" } } }',
          '{ colors: { light: { unknown: "#ffffff" } } }',
          '{ stylesheet: "../outside.css" }',
        ]) {
          await writeFile(
            join(root, 'plugin.mjs'),
            `export default { name: 'brand', version: '1.0.0', pluginApi: '1', capabilities: ['theme'], theme: () => (${theme}) };`,
          );
          await expect(buildSite(root, { trustPlugins: true })).rejects.toThrow(
            /plugin project configuration/,
          );
          expect(
            await readFile(join(first.directory, 'manifest.json'), 'utf8'),
          ).toBe(manifest);
        }
        const check = spawnSync(
          process.execPath,
          [
            resolve('packages/cli/dist/main.js'),
            'plugin-check',
            'plugin.mjs',
            root,
          ],
          { encoding: 'utf8' },
        );
        expect(check.status).not.toBe(0);
        expect(check.stderr).toContain('trust-plugins');
      },
    );
  });
});
