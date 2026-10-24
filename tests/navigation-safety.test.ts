import { expect, it } from 'vitest';
import { safeNavigationHref, withBase } from '@davidniessen/doctopus-contracts';

it('retains local navigation, query values, fragments and explicitly allowed HTTP(S) links', () => {
  expect(withBase('/docs', '/api/pets/?q=hello%20world#response')).toBe(
    '/docs/api/pets/?q=hello%20world#response',
  );
  expect(withBase('', 'guides/intro/')).toBe('/guides/intro/');
  expect(safeNavigationHref('/api/a%2Fb?literal=%25&quote=%22#x%20y')).toBe(
    '/api/a%2Fb?literal=%25&quote=%22#x%20y',
  );
  expect(safeNavigationHref('#heading-intro')).toBe('#heading-intro');
  expect(safeNavigationHref('https://example.test/migrate?q=a#step')).toBe(
    'https://example.test/migrate?q=a#step',
  );
  expect(safeNavigationHref('http://localhost:8080/docs')).toBe(
    'http://localhost:8080/docs',
  );
  expect(safeNavigationHref('/café/"<tag>')).toBe('/caf%C3%A9/%22%3Ctag%3E');
});

it('refuses executable schemes and credentials while retaining safe fragment text', () => {
  for (const value of [
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'blob:https://example.test/abc',
    'https://user:secret@example.test/',
  ])
    expect(safeNavigationHref(value)).toBe('#');
  expect(
    safeNavigationHref('#"<img onerror=alert(1)>').startsWith('#%22%3C'),
  ).toBe(true);
});

it('keeps base-prefixed links local through authority and dot-segment edge cases', () => {
  for (const base of [
    'https://evil.test',
    '//evil.test',
    'javascript:alert(1)',
  ])
    expect(withBase(base, '/docs')).toBe('#');
  for (const path of [
    '/.//evil.test/path',
    '/%2e//evil.test/path',
    '/.///evil.test/path',
  ]) {
    const value = withBase('', path);
    expect(value.startsWith('//')).toBe(false);
    expect(new URL(value, 'https://docs.example.test').origin).toBe(
      'https://docs.example.test',
    );
  }
  expect(withBase('', '/\\evil.test/path')).toBe('#');
});
