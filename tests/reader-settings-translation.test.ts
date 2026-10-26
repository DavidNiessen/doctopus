import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { createUiTranslation } from '@davidniessen/doctopus-contracts';
import { parseConfig } from '@davidniessen/doctopus-spec';
import { UiContext } from '../apps/reader/src/ui-translation.js';
import { ReaderSettingsControls } from '../apps/reader/src/components/ReaderSettingsControls.js';
import ReaderSettings from '../apps/reader/src/components/ReaderSettings.js';
import { defaultReaderPreferences } from '../apps/reader/src/reader-preferences.js';
const config = parseConfig({
  name: 'Settings fixture',
  specs: [{ id: 'api', path: 'openapi.yaml' }],
  locales: ['en', 'de-DE'],
  i18n: {
    messages: {
      de: {
        'settings.region': 'Persönliche Einstellungen',
        'appearance.title': 'Leseeinstellungen',
        'settings.theme': 'Farbschema <img src=x>',
        'settings.themeDefault': 'Veröffentlichtes Design',
      },
      'de-DE': { 'settings.unavailable': 'Speicher <nicht verfügbar>' },
    },
  },
});
const noop = () => {};
it('server-renders localized preset controls with escaped labels and independent regional/base fallback', () => {
  const controls = createElement(ReaderSettingsControls, {
    value: defaultReaderPreferences(),
    onChange: noop,
    stored: false,
  });
  const html = renderToStaticMarkup(
    createElement(
      UiContext.Provider,
      { value: createUiTranslation('de-DE', config.i18n) },
      controls,
    ),
  );
  expect(html).toContain('aria-label="Persönliche Einstellungen"');
  expect(html).toContain('Speicher &lt;nicht verfügbar&gt;');
  expect(html).toContain('Farbschema &lt;img src=x&gt;');
  expect(html).not.toContain('<img');
  expect(html).toContain('Documentation layout');
  expect(html).toContain('Veröffentlichtes Design');
  expect(html).not.toMatch(/type="color"|type="range"|value="custom"/);
  const english = renderToStaticMarkup(
    createElement(
      UiContext.Provider,
      { value: createUiTranslation('en', config.i18n) },
      controls,
    ),
  );
  expect(english).toContain('aria-label="Personal preferences"');
  expect(english).not.toContain('Persönliche Einstellungen');
});
it('server-renders a translated settings dialog with only prepared theme choices and stable public tokens', () => {
  const html = renderToStaticMarkup(
    createElement(
      UiContext.Provider,
      { value: createUiTranslation('de-DE', config.i18n) },
      createElement(ReaderSettings, {
        value: { ...defaultReaderPreferences(), theme: 'ocean' },
        onChange: noop,
        onClose: noop,
        stored: true,
      }),
    ),
  );
  expect(html).toContain('Leseeinstellungen');
  expect(html).toMatch(/checked="" value="ocean"/);
  expect(html).toContain('value="system"');
  expect(html).not.toContain('Response editor theme');
  expect(html.match(/<select/g)).toHaveLength(2);
  expect(html).not.toMatch(
    /Copy theme|Save current|type="color"|value="custom"/,
  );
});
