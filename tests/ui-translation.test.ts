import { expect, it } from 'vitest';
import {
  createUiTranslation,
  defaultUiMessages,
  validUiMessage,
} from '@davidniessen/doctopus-contracts';
import { parseConfig } from '@davidniessen/doctopus-spec';
import { renderDocument } from '@davidniessen/doctopus-reader/render';
const input = {
  name: 'Translated fixture',
  specs: [{ id: 'api', path: 'openapi.yaml' }],
  locales: ['en', 'de-DE'],
  defaultLocale: 'de-DE',
};
it('retains default English and requires explicit configuration for other languages', () => {
  const english = createUiTranslation('en');
  expect(english.text('playground.send')).toBe('Send');
  expect(english.fallback).toBe(0);
  const german = createUiTranslation('de');
  expect(german.text('playground.send')).toBe('Send');
  expect(german.translated).toBe(0);
  expect(german.fallback).toBe(Object.keys(defaultUiMessages).length);
});
it('resolves exact locale, then base language, then English without mutation', () => {
  const messages = {
    de: { 'playground.send': 'Senden', 'playground.cancel': 'Abbrechen' },
    'de-DE': { 'playground.send': 'Anfrage senden' },
  } as const;
  const before = JSON.stringify(messages);
  const config = parseConfig({ ...input, i18n: { messages } });
  const ui = createUiTranslation('de-DE', config.i18n);
  expect(ui.text('playground.send')).toBe('Anfrage senden');
  expect(ui.text('playground.cancel')).toBe('Abbrechen');
  expect(ui.text('response.headers')).toBe('Response headers');
  expect(ui.translated).toBe(2);
  expect(ui.translated + ui.fallback).toBe(ui.total);
  expect(JSON.stringify(messages)).toBe(before);
});
it('interpolates named parameters literally and allows translators to reorder them', () => {
  const ui = createUiTranslation('de', {
    messages: {
      de: {
        'playground.confirm': '{origin}: {method} senden?',
        'navigation.searchAll': '{count} Seiten durchsuchen',
      },
    },
  });
  expect(
    ui.text('playground.confirm', {
      method: 'POST',
      origin: 'https://api.example.test/$&/{method}',
    }),
  ).toBe('https://api.example.test/$&/{method}: POST senden?');
  expect(ui.text('navigation.searchAll', { count: 1200 })).toBe(
    '1200 Seiten durchsuchen',
  );
});
it.each([
  { 'playground.confirm': 'Missing context' },
  { 'playground.confirm': '{method} {host}' },
  { 'playground.send': '' },
  { 'playground.send': '  ' },
  { 'playground.send': 'a'.repeat(513) },
  { 'playground.send': 'bad\u0000text' },
  { 'unknown.message': 'unrecognized' },
])('rejects invalid or incomplete message definitions %#', (messages) => {
  expect(() =>
    parseConfig({ ...input, i18n: { messages: { de: messages } } }),
  ).toThrow();
});
it('rejects undeclared message locales and excessive or duplicate locale lists', () => {
  expect(() =>
    parseConfig({
      ...input,
      i18n: { messages: { fr: { 'playground.send': 'Envoyer' } } },
    }),
  ).toThrow(/configured locale/);
  expect(() => parseConfig({ ...input, locales: ['de-DE', 'de-DE'] })).toThrow(
    /Duplicate/,
  );
  expect(() => parseConfig({ ...input, locales: [] })).toThrow();
  expect(() =>
    parseConfig({
      ...input,
      locales: Array.from(
        { length: 17 },
        (_, i) =>
          String.fromCharCode(97 + Math.floor(i / 26)) +
          String.fromCharCode(97 + (i % 26)),
      ),
    }),
  ).toThrow();
  expect(() =>
    parseConfig({
      ...input,
      i18n: {
        messages: { de: { 'playground.send': 'Senden' } },
        clientScript: 'alert(1)',
      },
    }),
  ).toThrow();
});
it('ignores invalid runtime overrides and inherited keys in the public helper', () => {
  const inherited = Object.create({
    'playground.cancel': 'Inherited',
  }) as Record<string, string>;
  inherited['playground.send'] = '';
  const ui = createUiTranslation('de', { messages: { de: inherited } });
  expect(ui.translated).toBe(0);
  expect(ui.text('playground.send')).toBe('Send');
  expect(ui.text('playground.cancel')).toBe('Cancel');
  expect(validUiMessage('playground.dialog', '{title} testen')).toBe(true);
});
it('server-renders translated reader labels with literal text escaping and no shared locale state', () => {
  const config = parseConfig({
    ...input,
    i18n: {
      messages: {
        de: {
          'navigation.docs': 'Dokumentation',
          'search.label': 'Suchen <img src=x onerror=alert(1)>',
          'footer.builtWith': 'Erstellt mit doctopus',
        },
      },
    },
  });
  const site = {
    schemaVersion: 1 as const,
    config,
    apis: [],
    guides: [],
    diagnostics: [],
  };
  const html = renderDocument(site, '/');
  expect(html).toContain('lang="de-DE"');
  expect(html).toContain('Dokumentation');
  expect(html).toContain(
    'aria-label="Suchen &lt;img src=x onerror=alert(1)&gt;"',
  );
  expect(html).not.toContain('<img src=x onerror=alert(1)>');
  expect(
    renderDocument(
      { ...site, config: parseConfig({ name: 'English', specs: input.specs }) },
      '/',
    ),
  ).toContain('aria-label="Search documentation"');
});
