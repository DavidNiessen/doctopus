import { expect, it } from 'vitest';
import {
  feedbackHref,
  safeFeedbackUrl,
} from '@davidniessen/doctopus-contracts';
import { parseConfig } from '@davidniessen/doctopus-spec';

const input = {
  name: 'Feedback fixture',
  specs: [{ id: 'test', path: 'openapi.yaml' }],
};
it.each([
  'http://example.com/new',
  '//example.com/new',
  'javascript:alert(1)',
  'https://user:password@example.com/new',
  'https://example.com/\nnew',
  ' https://example.com/new',
  'https://example.com/new ',
  'https://example.com/' + 'a'.repeat(2048),
  'not-a-url',
])('rejects unsafe feedback destination %#', (url) => {
  expect(safeFeedbackUrl(url)).toBe(false);
  expect(() => parseConfig({ ...input, feedback: { url } })).toThrow();
});
it('requires explicit public canonical configuration before sharing page context', () => {
  expect(() =>
    parseConfig({
      ...input,
      feedback: { url: 'https://issues.example.com/new', includePage: true },
    }),
  ).toThrow(/siteUrl/);
  expect(() =>
    parseConfig({
      ...input,
      feedback: { url: 'https://issues.example.com/new', label: '  ' },
    }),
  ).toThrow();
  expect(() =>
    parseConfig({
      ...input,
      feedback: { url: 'https://issues.example.com/new', includeSecrets: true },
    }),
  ).toThrow();
});
it('is disabled by default and does not share page context without opt-in', () => {
  expect(feedbackHref(parseConfig(input), '/')).toBeUndefined();
  const config = parseConfig({
    ...input,
    siteUrl: 'https://docs.example.com',
    feedback: { url: 'https://issues.example.com/new?template=docs' },
  });
  expect(feedbackHref(config, '/api/private/?token=secret')).toBe(
    'https://issues.example.com/new?template=docs',
  );
});
it('adds only the public canonical path and retains configured issue template content', () => {
  const config = parseConfig({
    ...input,
    basePath: '/gallery',
    siteUrl: 'https://docs.example.com',
    feedback: {
      url: 'https://issues.example.com/new?template=docs&body=Existing',
      includePage: true,
    },
  });
  const url = new URL(
    feedbackHref(config, '/api/test/v1/read/?token=browser-secret#private')!,
  );
  expect(url.origin).toBe('https://issues.example.com');
  expect(url.searchParams.get('template')).toBe('docs');
  expect(url.searchParams.get('body')).toBe(
    'Existing\n\nDocumentation page: https://docs.example.com/gallery/api/test/v1/read/',
  );
  expect(url.href).not.toContain('browser-secret');
  expect(url.href).not.toContain('private');
});
it('omits invalid or excessive page context without losing the configured issue destination', () => {
  const config = parseConfig({
    ...input,
    siteUrl: 'https://docs.example.com',
    feedback: { url: 'https://issues.example.com/new', includePage: true },
  });
  for (const path of [
    '//other.example.com',
    '/../outside',
    '/%2e%2e/outside',
    '/back\\slash',
    '/' + 'a'.repeat(5000),
  ])
    expect(feedbackHref(config, path)).toBe(config.feedback!.url);
});
