import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  createUiTranslation,
  validUiMessage,
} from '@davidniessen/doctopus-contracts';
import type { ApiDocument, Operation } from '@davidniessen/doctopus-contracts';
import { parseConfig } from '@davidniessen/doctopus-spec';
import { renderDocument } from '@davidniessen/doctopus-reader/render';
import { UiContext } from '../apps/reader/src/ui-translation.js';
import { ParameterInput } from '../apps/reader/src/components/ParameterInput.js';
import { MediaExamples } from '../apps/reader/src/components/MediaExamples.js';

const messages = {
  'api.authorization': 'Autorisierung',
  'api.authOptional': 'Anmeldung optional.',
  'api.anonymous': 'Anonym',
  'api.or': 'oder',
  'api.pathParameters': 'Pfadparameter',
  'api.queryParameters': 'Abfrageparameter',
  'api.headerParameters': 'Header-Parameter',
  'api.cookieParameters': 'Cookie-Parameter',
  'api.requestBody': 'Anfrageinhalt',
  'api.parameterDescription': '{location}: {name}',
  'response.title': 'Antwort',
  'schema.required': 'erforderlich',
  'parameter.label': 'Parameter {name}',
  'parameter.qualifiedLabel': '{location}: Parameter {name}',
  'parameter.include': 'Mitsenden',
  'parameter.allowEmpty': 'Leer erlauben',
  'parameter.presenceLabel': '{name} ({location}): {action}',
  'parameter.omitted': 'Als Entwurf behalten.',
  'parameter.empty': 'Leerer Wert wird gesendet.',
  'parameter.value': 'Wert eingeben',
  'examples.responseTitle': 'Antwortbeispiel',
  'examples.responseSelector': 'Antwort auswählen',
  'examples.generatedTitle': '{title} · generiert',
  'examples.external': 'Externe Beispiele bleiben offline.',
  'code.copyLabel': 'Code kopieren',
  'code.copy': 'Kopieren',
} as const;
const config = parseConfig({
  name: 'Reference fixture',
  specs: [{ id: 'api', path: 'openapi.yaml' }],
  locales: ['en', 'de-DE'],
  defaultLocale: 'de-DE',
  i18n: { messages: { de: messages } },
});
const render = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(
      UiContext.Provider,
      { value: createUiTranslation('de-DE', config.i18n) },
      element,
    ),
  );
const noop = () => {};

it('server-renders endpoint headings with language fallback and literal API identities', () => {
  const operation: Operation = {
    id: 'inspect',
    slug: 'inspect',
    method: 'get',
    path: '/values/{id}',
    summary: 'Authored API title',
    description: '',
    tags: [],
    deprecated: false,
    source: 'openapi.yaml#/paths',
    servers: ['https://api.example.test'],
    security: [{ token: [] }, {}],
    parameters: (['path', 'query', 'header', 'cookie'] as const).map(
      (location) => ({
        name: location === 'path' ? 'id' : 'wireName',
        in: location,
        required: location === 'path',
        description: '',
        schema: { type: 'string' },
      }),
    ),
    requestBody: {
      required: true,
      description: '',
      content: { 'application/json': { schema: { type: 'object' } } },
    },
    responses: [
      {
        status: '200',
        description: 'Authored response',
        headers: {},
        content: {
          'application/json': { schema: { type: 'boolean' }, example: false },
          'text/plain': { schema: { type: 'string' }, example: 'wire value' },
        },
      },
    ],
  };
  const api: ApiDocument = {
    id: 'api',
    version: 'v1',
    title: 'Authored API',
    description: '',
    source: 'openapi.yaml',
    operations: [operation],
    schemas: {},
    securitySchemes: { token: { type: 'apiKey', in: 'header', name: 'X-Key' } },
    diagnostics: [],
    servers: operation.servers,
  };
  const site = {
    schemaVersion: 1 as const,
    config,
    apis: [api],
    guides: [],
    diagnostics: [],
  };
  const html = renderDocument(site, '/api/api/v1/inspect/');
  for (const value of [
    'Autorisierung',
    'Anmeldung optional.',
    'token oder Anonym',
    'Pfadparameter',
    'Abfrageparameter',
    'Header-Parameter',
    'Cookie-Parameter',
    'Anfrageinhalt',
    'erforderlich',
    'query: wireName',
    'Authored API title',
    'Authored response',
    'Response content type',
    'Code kopieren',
  ])
    expect(html).toContain(value);
  const english = renderDocument(
    { ...site, config: { ...config, defaultLocale: 'en' } },
    '/api/api/v1/inspect/',
  );
  expect(english).toContain('<h2>Query parameters</h2>');
  expect(english).not.toContain('<h2>Abfrageparameter</h2>');
});

it('localizes parameter identities without boilerplate hints or treating source names as markup', () => {
  const html = render(
    createElement(ParameterInput, {
      parameter: {
        name: '<img src=x>',
        in: 'query',
        required: false,
        description: '',
        schema: { type: 'string' },
      },
      value: 'draft',
      presence: false,
      allowEmpty: true,
      qualified: true,
      onChange: noop,
      onPresence: noop,
    }),
  );
  expect(html).toContain('aria-label="query: Parameter &lt;img src=x&gt;"');
  expect(html).toContain('aria-label="&lt;img src=x&gt; (query): Mitsenden"');
  expect(html).not.toContain('Als Entwurf behalten.');
  expect(html).toContain('value="draft"');
  expect(html).not.toContain('<img');
});

it('retains empty-value presence and localized required guidance', () => {
  const html = render(
    createElement(ParameterInput, {
      parameter: {
        name: 'id',
        in: 'path',
        required: true,
        description: '',
        schema: { type: 'string' },
      },
      value: '',
      presence: true,
      allowEmpty: true,
      qualified: false,
      onChange: noop,
      onPresence: noop,
    }),
  );
  expect(html).toContain('Parameter id');
  expect(html).toContain('request-required-badge">erforderlich');
  expect(html).toContain('id (path): Leer erlauben');
  expect(html).not.toContain('Leerer Wert wird gesendet.');
  expect(html).toContain('placeholder="Wert eingeben"');
  expect(html).toContain('checked=""');
});

it('localizes generated example and clipboard controls while preserving authored labels and values', () => {
  const generated = render(
    createElement(MediaExamples, {
      media: { schema: { type: 'boolean' } },
      mediaType: 'application/json',
      schemas: {},
    }),
  );
  expect(generated).toContain('Antwortbeispiel · generiert');
  expect(generated).toContain('aria-label="Code kopieren"');
  expect(generated).toContain('Kopieren');
  const named = render(
    createElement(MediaExamples, {
      media: {
        schema: {},
        examples: {
          local: { summary: 'Authored <img>', value: false },
          other: { value: 0 },
          remote: { externalValue: 'https://offline.invalid/example' },
        },
      },
      mediaType: 'application/json',
      schemas: {},
    }),
  );
  expect(named).toContain('Antwort auswählen');
  expect(named).toContain('Authored &lt;img&gt;');
  expect(named).toContain('Externe Beispiele bleiben offline.');
  expect(named).toContain('false');
  expect(named).not.toContain('<img');
});

it('requires named parameter context in translated labels and generated titles', () => {
  expect(validUiMessage('parameter.qualifiedLabel', '{location}: {name}')).toBe(
    true,
  );
  expect(validUiMessage('parameter.qualifiedLabel', '{name}')).toBe(false);
  expect(validUiMessage('examples.generatedTitle', 'Generiert: {title}')).toBe(
    true,
  );
  expect(validUiMessage('examples.generatedTitle', 'Generiert')).toBe(false);
  expect(() =>
    parseConfig({
      ...config,
      i18n: { messages: { de: { 'api.incomingPayload': 'Fehlt' } } },
    }),
  ).toThrow();
});
