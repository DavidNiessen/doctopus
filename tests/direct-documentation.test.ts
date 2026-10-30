import { describe, expect, it } from 'vitest';
import {
  directDocumentationConfig,
  encodeHtmlJson,
  isDirectDocumentationRoute,
} from '@davidniessen/doctopus-contracts';
import { renderDirectDocumentation } from '@davidniessen/doctopus-reader/integration';
describe('direct API references', () => {
  it('escapes host branding once without executing HTML or replacing user placeholders', async () => {
    const title =
      'Company </script><script>alert(1)</script> __DOCTOPUS_CONFIG__';
    const html = await renderDirectDocumentation(
      { url: '/openapi.json', title },
      '/gateway/docs',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('href="/gateway/docs/assets/reader.css"');
    const json = html.match(
      /id="doctopus-direct-config" type="application\/json">([^<]*)<\/script>/,
    )?.[1];
    expect(JSON.parse(json!)).toMatchObject({
      title,
      url: '/openapi.json',
      basePath: '/gateway/docs',
    });
    expect(encodeHtmlJson({ title: '</script>' })).not.toContain('<');
  });
  it('accepts the replacement palettes and loads appearance before the direct shell', async () => {
    for (const theme of ['ember', 'contrast'] as const) {
      const html = await renderDirectDocumentation({ theme }, '/docs');
      expect(html).toContain('src="/docs/assets/theme.js"');
      expect(html.indexOf('src="/docs/assets/theme.js"')).toBeLessThan(
        html.indexOf('<body>'),
      );
      expect(directDocumentationConfig({ theme }, '/docs').theme).toBe(theme);
    }
  });
  it('rejects ambiguous URL protocols and unsafe mount paths and keeps missing assets out of shell routing', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'https://user:secret@example.com/openapi.json',
      '/openapi.json#secret',
    ])
      expect(() => directDocumentationConfig({ url }, '/docs')).toThrow();
    for (const mount of [
      '/docs/',
      '//evil.example.com',
      '/docs/../private',
      '/docs"',
    ])
      expect(() =>
        directDocumentationConfig({ url: '/openapi.json' }, mount),
      ).toThrow();
    expect(isDirectDocumentationRoute('/api/api/v1/hello/')).toBe(true);
    for (const path of [
      '/assets/missing.js',
      '/private.json',
      '/manifest.json',
      '/api/api/v1/..',
    ])
      expect(isDirectDocumentationRoute(path)).toBe(false);
  });
});
