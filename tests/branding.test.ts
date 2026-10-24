import { describe, it, expect } from 'vitest';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseConfig } from '@davidniessen/doctopus-spec';
import { buildSite, createStaticServer } from '@davidniessen/doctopus-cli';
import {
  loadPublicAssets,
  verifyArtifact,
} from '@davidniessen/doctopus-compiler';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX8cAAAAASUVORK5CYII=',
  'base64',
);
const minimal = {
  name: 'Branded docs',
  specs: [{ id: 'api', path: 'openapi.yaml' }],
};
describe('branding, assets and indexing', () => {
  it('validates presets, layout bounds, palette contrast and HTTPS canonical origins', () => {
    expect(
      parseConfig({ ...minimal, theme: { preset: 'ocean' } }).theme.accent,
    ).toBe('#2563eb');
    expect(
      parseConfig({ ...minimal, siteUrl: 'https://docs.example.com/' }).siteUrl,
    ).toBe('https://docs.example.com');
    for (const invalid of [
      { theme: { colors: { light: { text: '#eeeeee' } } } },
      { theme: { sidebarWidth: 10000 } },
      { siteUrl: 'https://user:password@example.com' },
      { siteUrl: 'invalid' },
      { logo: '../secret' },
      { logoDark: 'dark.png' },
    ])
      expect(() => parseConfig({ ...minimal, ...invalid })).toThrow();
  });
  it('builds branding assets, canonical/social metadata and a base-aware sitemap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-branding-'));
    await cp(resolve('examples/demo'), root, {
      recursive: true,
      filter: (path) =>
        !path.includes('.doctopus') && !path.includes('.api-docs'),
    });
    await mkdir(join(root, 'public'));
    await writeFile(join(root, 'public', 'brand.png'), png);
    await writeFile(
      join(root, 'public', 'custom.css'),
      '.docs-shell .brand { letter-spacing: 1px; }',
    );
    await writeFile(
      join(root, 'docs.config.yaml'),
      (await readFile(join(root, 'docs.config.yaml'), 'utf8')) +
        '\nbasePath: /manual\nsiteUrl: https://docs.example.com\nlogo: brand.png\nfavicon: brand.png\nseo:\n  socialImage: brand.png\n',
    );
    // Extend the existing theme without duplicate YAML keys.
    const config = join(root, 'docs.config.yaml');
    await writeFile(
      config,
      (await readFile(config, 'utf8')).replace(
        '  radius: 10',
        '  radius: 10\n  stylesheet: custom.css',
      ),
    );
    const built = await buildSite(root);
    const manifest = await verifyArtifact(built.directory);
    expect(manifest.files).toHaveProperty('media/brand.png');
    expect(manifest.files).toHaveProperty('media/custom.css');
    const html = await readFile(
      join(built.directory, 'guides/introduction/index.html'),
      'utf8',
    );
    expect(html).toContain(
      'rel="canonical" href="https://docs.example.com/manual/guides/introduction/"',
    );
    expect(html).toContain(
      'property="og:image" content="https://docs.example.com/manual/media/brand.png"',
    );
    expect(html).toContain('src="/manual/media/brand.png"');
    expect(html).toContain('href="/manual/media/custom.css"');
    const sitemap = await readFile(
      join(built.directory, 'sitemap.xml'),
      'utf8',
    );
    expect(sitemap).toContain(
      'https://docs.example.com/manual/api/orbit/v1/create-project/',
    );
    expect(sitemap).not.toContain('not-found');
    expect(
      await readFile(join(built.directory, 'robots.txt'), 'utf8'),
    ).toContain('Sitemap: https://docs.example.com/manual/sitemap.xml');
    expect(
      await readFile(join(built.directory, '404.html'), 'utf8'),
    ).not.toContain('rel="canonical"');
    const server = await createStaticServer(built.directory);
    try {
      const asset = await server.inject('/manual/media/brand.png');
      expect(asset.statusCode).toBe(200);
      expect(asset.rawPayload).toEqual(png);
    } finally {
      await server.close();
    }
    await writeFile(
      config,
      (await readFile(config, 'utf8')).replace(
        'seo:\n',
        'seo:\n  index: false\n',
      ),
    );
    const privateBuild = await buildSite(root);
    expect(
      (await verifyArtifact(privateBuild.directory)).files,
    ).not.toHaveProperty('sitemap.xml');
    expect(
      await readFile(join(privateBuild.directory, 'robots.txt'), 'utf8'),
    ).toContain('Disallow: /');
    expect(
      await readFile(join(privateBuild.directory, 'index.html'), 'utf8'),
    ).toContain('content="noindex,nofollow"');
  });
  it('rejects executable assets, image spoofing, missing references and symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-asset-boundary-'));
    await mkdir(join(root, 'public'));
    await writeFile(
      join(root, 'public', 'active.svg'),
      '<svg onload="alert(1)"></svg>',
    );
    await expect(loadPublicAssets(root, parseConfig(minimal))).rejects.toThrow(
      /Unsupported public asset/,
    );
    const renamed = join(root, 'public', 'active.png');
    await writeFile(renamed, '<script>malicious</script>');
    // Remove the deliberately unsupported fixture before checking the image boundary.
    const { unlink } = await import('node:fs/promises');
    await unlink(join(root, 'public', 'active.svg'));
    await expect(loadPublicAssets(root, parseConfig(minimal))).rejects.toThrow(
      /signature/,
    );
    await writeFile(renamed, png);
    await expect(
      loadPublicAssets(root, parseConfig({ ...minimal, logo: 'missing.png' })),
    ).rejects.toThrow(/does not exist/);
    await symlink(renamed, join(root, 'public', 'linked.png'));
    await expect(loadPublicAssets(root, parseConfig(minimal))).rejects.toThrow(
      /symlinks/,
    );
  });
});
