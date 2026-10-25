import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { createUiTranslation } from '@davidniessen/doctopus-contracts';
import type {
  LifecycleRecord,
  LifecyclePage,
  Schema,
} from '@davidniessen/doctopus-contracts';
import { UiContext } from '../apps/reader/src/ui-translation.js';
import { SchemaView } from '../apps/reader/src/components/SchemaView.js';
import {
  DeprecationCenter,
  OperationLifecycle,
} from '../apps/reader/src/components/Lifecycle.js';
const ui = createUiTranslation('de', {
  messages: {
    de: {
      'schema.allowed': 'Erlaubte Werte:',
      'schema.required': 'erforderlich',
      'schema.deprecated': 'veraltet',
      'schema.variant': 'Auswahl {number}',
      'schema.noValue': 'kein Wert erlaubt',
      'schema.anyValue': 'beliebiger Wert',
      'schema.recursive': 'Rekursive Referenz:',
      'schema.depth': 'Maximale Tiefe erreicht.',
      'navigation.deprecations': 'Abkündigungen',
      'lifecycle.countOne': '{count} Endpunkt',
      'lifecycle.inGroup': '{title} ({version}): {count}',
      'lifecycle.page': '{pages} Seiten, aktuelle Seite {page}',
      'lifecycle.deprecated': 'Abgekündigt',
      'lifecycle.region': 'Lebenszyklus',
      'lifecycle.replacement': 'Nachfolger',
      'lifecycle.noScript': 'Kalenderstatus benötigt JavaScript.',
      'lifecycle.replacementUnavailable': 'Bitte API-Verantwortlichen fragen.',
    },
  },
});
const render = (element: ReactElement) =>
  renderToStaticMarkup(
    createElement(UiContext.Provider, { value: ui }, element),
  );

it('localizes schema guidance while retaining technical keywords, property names and safely escaped values', () => {
  const schema: Schema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: {
        type: 'string',
        deprecated: true,
        enum: ['<img src=x onerror=alert(1)>', null, false, 0],
      },
      unrestricted: true,
      forbidden: false,
    },
    oneOf: [{ type: 'string' }, { const: null }],
    additionalProperties: false,
  };
  const html = render(createElement(SchemaView, { schema, schemas: {} }));
  for (const text of [
    'Erlaubte Werte:',
    'erforderlich',
    'veraltet',
    'Auswahl 1',
    'kein Wert erlaubt',
    'beliebiger Wert',
  ])
    expect(html).toContain(text);
  expect(html).toContain('<code>name</code>');
  expect(html).not.toContain('<dt>required</dt>');
  expect(
    render(
      createElement(SchemaView, {
        schema: { type: 'object', required: ['undeclared'] },
        schemas: {},
      }),
    ),
  ).toContain('<dt>required</dt>');
  expect(html).toContain('Exactly one variant must match.');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain('<img');
  const english = renderToStaticMarkup(
    createElement(SchemaView, { schema, schemas: {} }),
  );
  expect(english).toContain('Allowed values:');
  expect(english).not.toContain('Erlaubte Werte:');
});
it('localizes recursion and depth boundaries independently of referenced schema identity', () => {
  const schema = { $ref: '#/components/schemas/Node' };
  expect(
    render(
      createElement(SchemaView, {
        schema,
        schemas: {},
        visited: new Set([schema.$ref]),
      }),
    ),
  ).toContain('Rekursive Referenz:');
  expect(
    render(
      createElement(SchemaView, {
        schema,
        schemas: {},
        visited: new Set([schema.$ref]),
      }),
    ),
  ).toContain('<code>Node</code>');
  expect(
    render(createElement(SchemaView, { schema: {}, schemas: {}, depth: 7 })),
  ).toContain('Maximale Tiefe erreicht.');
});
it('localizes static lifecycle guidance, named result context and pagination without depending on the build clock', () => {
  const entry: LifecycleRecord = {
    apiId: 'api',
    apiTitle: 'Authored API',
    version: 'v1',
    operationId: 'legacy',
    kind: 'endpoint',
    method: 'GET',
    path: '/legacy',
    summary: 'Authored <summary>',
    href: '/api/api/v1/legacy/',
    source: '#/paths/legacy/get',
    deprecated: true,
    lifecycle: {
      deprecatedOn: '2026-01-01',
      sunsetOn: '2027-01-01',
      message: 'Authored guidance',
    },
    replacementHref: '/api/api/v2/current/',
    replacementIssue: 'ambiguous',
  };
  const group = {
    apiId: 'api',
    title: 'Authored API',
    version: 'v1',
    total: 1,
    href: '/deprecations/api/api/version/v1/',
  };
  const page: LifecyclePage = {
    total: 1,
    matched: 1,
    number: 1,
    pages: 2,
    groups: [group],
    groupHref: group.href,
    entries: [entry],
    next: group.href + 'page/2/',
  };
  const html = render(
    createElement(DeprecationCenter, { page, basePath: '/docs/de' }),
  );
  expect(html).toContain('Abkündigungen');
  expect(html).toContain('Authored API (v1): 1 Endpunkt');
  expect(html).toContain('2 Seiten, aktuelle Seite 1');
  expect(html).toContain('Kalenderstatus benötigt JavaScript.');
  expect(html).toContain('Authored &lt;summary&gt;');
  expect(html).toContain('Authored guidance');
  expect(html).toContain('Bitte API-Verantwortlichen fragen.');
  expect(html).toContain('href="/docs/de/api/api/v2/current/"');
  const notice = render(
    createElement(OperationLifecycle, { entry, basePath: '/docs/de' }),
  );
  expect(notice).toContain('aria-label="Lebenszyklus"');
  expect(notice).toContain('Abgekündigt');
});
