import assert from 'node:assert/strict';
import test from 'node:test';
import { demoHandbook, handbookMarkdown } from '../lib/demo-handbook.mjs';

test('handbook links use published routes and reader fragments while preserving literal examples', () => {
  const source = [
    '# Installation',
    '',
    '[CLI](cli.md#preview) and [here](#setup).',
    '[Existing](cli.md#heading-preview).',
    '[Repository](../README.md#installation).',
    '[Config](../.node-version).',
    '[`.node-version`](../.node-version).',
    '[External](https://example.com/docs#setup).',
    '![Diagram](design/screenshots/reader-dark.png).',
    '`[Literal](cli.md#preview)`.',
    '```md',
    '[Literal](cli.md#preview)',
    '```',
    '[reference]: cli.md#preview',
  ].join('\n');
  const result = handbookMarkdown(
    source,
    'docs/installation.md',
    'installation/setup',
  );
  assert(result.startsWith('[CLI](cli.md#heading-preview)'));
  assert(result.includes('[here](#heading-setup)'));
  assert(result.includes('[Existing](cli.md#heading-preview)'));
  assert(
    result.includes(
      'https://github.com/DavidNiessen/doctopus/blob/master/README.md#installation',
    ),
  );
  assert(
    result.includes(
      'https://github.com/DavidNiessen/doctopus/blob/master/.node-version',
    ),
  );
  assert(
    result.includes(
      '[`.node-version`](https://github.com/DavidNiessen/doctopus/blob/master/.node-version)',
    ),
  );
  assert(result.includes('https://example.com/docs#setup'));
  assert(
    result.includes(
      'https://raw.githubusercontent.com/DavidNiessen/doctopus/master/docs/design/screenshots/reader-dark.png',
    ),
  );
  assert(result.includes('`[Literal](cli.md#preview)`'));
  assert(result.includes('```md\n[Literal](cli.md#preview)\n```'));
  assert(result.includes('[reference]: cli.md#heading-preview'));
});

test('handbook navigation has unique sources, nested routes and ordered user-facing groups', () => {
  assert.equal(
    new Set(demoHandbook.map(({ source }) => source)).size,
    demoHandbook.length,
  );
  assert.equal(
    new Set(demoHandbook.map(({ slug }) => slug)).size,
    demoHandbook.length,
  );
  assert.deepEqual(
    [...new Set(demoHandbook.map(({ group }) => group))],
    ['Installation', 'Integrations', 'Authoring', 'Playground', 'Operations'],
  );
  for (let index = 0; index < demoHandbook.length; index++) {
    const entry = demoHandbook[index];
    assert.match(entry.source, /^docs\/[a-z-]+\.md$/);
    assert.match(entry.slug, /^[a-z-]+\/[a-z-]+$/);
    assert(entry.title && entry.description);
    if (index) assert(entry.order > demoHandbook[index - 1].order);
  }
});
