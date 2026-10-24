import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadGuides, renderMarkdown } from '@davidniessen/doctopus-content';
import {
  contrastRatio,
  readableAccent,
  resolvePalette,
} from '@davidniessen/doctopus-contracts';
async function project(source: string, filename = 'intro.md') {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-content-'));
  await mkdir(join(root, 'guides'));
  await writeFile(join(root, 'guides', filename), source);
  return root;
}
describe('authored guide boundaries', () => {
  it('makes sanitized code blocks keyboard-scrollable without allowing authored focus order or handlers', async () => {
    const markdown = await renderMarkdown('```txt\nlong code line\n```');
    expect(markdown.html).toContain('<pre tabindex="0">');
    const authored = await renderMarkdown(
      '<pre tabindex="7" onclick="alert(1)"><code>text</code></pre>',
      true,
    );
    expect(authored.html).toContain('<pre tabindex="0">');
    expect(authored.html).not.toContain('onclick');
    expect(authored.html).not.toContain('tabindex="7"');
  });
  it('accepts empty frontmatter, derives headings and indexes only sanitized content', async () => {
    const root = await project(
      '---\n---\n# Introduction\n\nReadable text.\n\n<script>not_indexed()</script>',
    );
    const guide = (await loadGuides(root, 'guides'))[0]!;
    expect(guide.title).toBe('Introduction');
    expect(guide.html).not.toContain('<hr');
    expect(guide.text).toContain('Readable text.');
    expect(guide.text).not.toContain('not_indexed');
  });
  it.each([
    'title: null',
    'unknown: value',
    'order: .nan',
    '- array',
    'a scalar',
  ])('rejects invalid frontmatter: %s', async (metadata) => {
    const root = await project(`---\n${metadata}\n---\n# Guide`);
    await expect(loadGuides(root, 'guides')).rejects.toThrow(
      /invalid frontmatter/,
    );
  });
  it('rejects normalized route collisions and symlinks', async () => {
    const root = await project('# One', 'my_guide.md');
    await writeFile(join(root, 'guides', 'my-guide.md'), '# Two');
    await expect(loadGuides(root, 'guides')).rejects.toThrow(/collision/);
    const linked = await project('# Safe');
    await symlink(
      join(linked, 'guides', 'intro.md'),
      join(linked, 'guides', 'linked.md'),
    );
    await expect(loadGuides(linked, 'guides')).rejects.toThrow(/symlinks/);
  });
  it('requires explicit MDX trust and renders reusable components through bounded workers', async () => {
    const root = await project(
      `---
title: Integration guide
---

# Getting started

<Callout title="Before you start" type="tip">Use a test workspace.</Callout>

<Tabs>
  <Tab title="JavaScript">JavaScript example</Tab>
  <Tab title="Java">Java example</Tab>
</Tabs>

<Steps><Step title="Create a key">Save it securely.</Step></Steps>

<Accordion title="Details">Extra information.</Accordion>

<CardGroup><Card title="Reference" href="/api/events/v1/getevent/">API documentation</Card></CardGroup>

<ApiLink href="/api/events/v1/getevent/">Read the endpoint</ApiLink>

<Schema schema={{type:'string',enum:['こんにちは','hello']}} />

<script>alert('removed')</script>
`,
      'intro.mdx',
    );
    await expect(loadGuides(root, 'guides')).rejects.toThrow(/--trust-content/);
    const guide = (
      await loadGuides(root, 'guides', {
        trustContent: true,
        basePath: '/docs',
      })
    )[0]!;
    expect(guide.html).toContain('role="tablist"');
    expect(guide.html).toContain('data-guide-tab="true"');
    expect(guide.html).toMatch(/aria-controls="component-/);
    expect(guide.html).toContain('role="tabpanel"');
    expect(guide.html).not.toContain(' hidden');
    expect(guide.html).toContain('content-callout tip');
    expect(
      guide.html.match(/href="\/docs\/api\/events\/v1\/getevent\/"/g),
    ).toHaveLength(2);
    expect(guide.html).toContain('こんにちは');
    expect(guide.html).not.toContain('<script');
    expect(guide.text).toContain('Save it securely.');
    expect(guide.text).not.toContain('schema={{');
    expect(guide.headings[0]).toMatchObject({ id: 'heading-getting-started' });
  });
  it('supports reviewed local component imports', async () => {
    const root = await project(
      "import { name } from './shared.mjs'\n\n# {name}\n",
      'intro.mdx',
    );
    await writeFile(
      join(root, 'guides', 'shared.mjs'),
      "export const name = 'Imported guide';\n",
    );
    expect(
      (await loadGuides(root, 'guides', { trustContent: true }))[0]!.html,
    ).toContain('Imported guide');
  });
  it('terminates stalled MDX execution without publishing arbitrary worker logs', async () => {
    const root = await project(
      'export const block = (()=>{while(true){}})()\n\n# Stalled',
      'intro.mdx',
    );
    await expect(
      loadGuides(root, 'guides', { trustContent: true }),
    ).rejects.toThrow(/5 second execution limit/);
    await writeFile(
      join(root, 'guides', 'intro.mdx'),
      "export const block = (()=>{ console.log('do-not-forward-content-logs'); throw new Error('private-data'); })()\n\n# Broken",
    );
    await expect(
      loadGuides(root, 'guides', { trustContent: true }),
    ).rejects.toThrow(/Trusted MDX failed/);
  });
});

describe('brand color accessibility', () => {
  it.each(['#16a076', '#ffffff', '#000000', '#ffff00', '#ff0000', '#0000ff'])(
    'derives readable light/dark text for %s',
    (accent) => {
      for (const mode of ['light', 'dark'] as const) {
        const palette = resolvePalette({}, mode);
        for (const background of [palette.background, palette.surface]) {
          expect(
            contrastRatio(readableAccent(accent, mode), background),
          ).toBeGreaterThanOrEqual(5);
        }
      }
    },
  );
});
