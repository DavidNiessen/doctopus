import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import rehypeParse from 'rehype-parse';
import { renderTrustedMdx } from './mdx.js';
import { relative, resolve, dirname, sep } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import {
  confinedPath,
  parseSource,
  readTextFile,
} from '@davidniessen/doctopus-spec';
import { slugify, withBase } from '@davidniessen/doctopus-contracts';
import type { Guide } from '@davidniessen/doctopus-contracts';

const nodeText = (node: {
  type: string;
  value?: string;
  children?: unknown[];
}): string =>
  node.type === 'text'
    ? (node.value ?? '')
    : (node.children ?? [])
        .map((child) => nodeText(child as typeof node))
        .join('');
export async function renderMarkdown(
  source: string,
  html = false,
  options: { rewriteLink?: (url: string) => string } = {},
): Promise<{
  html: string;
  headings: Guide['headings'];
  text: string;
  links: NonNullable<Guide['links']>;
  anchors: string[];
}> {
  const headings: Guide['headings'] = [];
  const used = new Set<string>();
  let tree: Root;
  if (html) tree = unified().use(rehypeParse, { fragment: true }).parse(source);
  else {
    const markdown = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype);
    tree = await markdown.run(markdown.parse(source));
  }
  const processor = unified()
    .use(() => (tree: Root) => {
      visit(tree, 'element', (node: Element) => {
        if (
          node.tagName === 'a' &&
          typeof node.properties.href === 'string' &&
          options.rewriteLink
        )
          node.properties.href = options.rewriteLink(node.properties.href);
        if (
          node.tagName === 'img' &&
          typeof node.properties.src === 'string' &&
          options.rewriteLink
        )
          node.properties.src = options.rewriteLink(node.properties.src);
        if (/^h[1-6]$/.test(node.tagName)) {
          const text = nodeText(node);
          let id = `heading-${slugify(text)}`;
          let count = 2;
          while (used.has(id)) id = `heading-${slugify(text)}-${count++}`;
          used.add(id);
          node.properties.id = id;
          headings.push({ id, text, level: Number(node.tagName.slice(1)) });
        }
      });
    })
    .use(rehypeSanitize, {
      ...defaultSchema,
      tagNames: [
        ...(defaultSchema.tagNames ?? []),
        'button',
        'aside',
        'figure',
        'figcaption',
      ],
      clobberPrefix: '',
      attributes: {
        ...defaultSchema.attributes,
        '*': ['className'],
        h1: ['id'],
        h2: ['id'],
        h3: ['id'],
        h4: ['id'],
        h5: ['id'],
        h6: ['id'],
        code: [['className', /^language-./]],
        button: [
          'type',
          'role',
          'tabIndex',
          'ariaSelected',
          'ariaControls',
          'dataGuideTab',
          ['id', /^component-/],
        ],
        section: [
          'role',
          'hidden',
          'tabIndex',
          'ariaLabelledBy',
          ['id', /^component-/],
        ],
        div: ['role', 'ariaLabel'],
        aside: ['role'],
      },
    })
    .use(rehypeStringify);
  const result = await processor.run(tree);
  const parts: string[] = [];
  const links: NonNullable<Guide['links']> = [],
    anchors: string[] = [];
  visit(result, 'element', (node: Element) => {
    // Overflowing code must be keyboard-scrollable, including without JavaScript.
    if (node.tagName === 'pre') node.properties.tabIndex = 0;
    if (typeof node.properties.id === 'string')
      anchors.push(node.properties.id);
    if (node.tagName === 'a' && typeof node.properties.href === 'string') {
      links.push({ kind: 'link', url: node.properties.href });
      if (options.rewriteLink && /^\/(?!\/)/.test(node.properties.href))
        node.properties.dataDocRoute = true;
    }
    if (node.tagName === 'img' && typeof node.properties.src === 'string')
      links.push({ kind: 'image', url: node.properties.src });
  });
  if (links.length > 10_000 || anchors.length > 10_000)
    throw new Error('Guide link/anchor count exceeds 10,000');
  visit(result, 'text', (node) => {
    parts.push(node.value);
  });
  return {
    html: processor.stringify(result),
    headings,
    links,
    anchors,
    text: parts.join(' ').replace(/\s+/g, ' ').trim(),
  };
}
const frontmatter = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(1000).default(''),
    group: z.string().trim().min(1).max(80).default('Get started'),
    order: z.number().finite().min(-1_000_000).max(1_000_000).default(100),
  })
  .strict();
export interface GuideReadBudget {
  entries: number;
  bytes: number;
  guides: number;
}
export async function loadGuides(
  root: string,
  directory: string,
  options: {
    trustContent?: boolean;
    basePath?: string;
    only?: ReadonlySet<string>;
    budget?: GuideReadBudget;
    /** Prefix documentation links while keeping shared media at basePath. */
    localePrefix?: string;
  } = {},
): Promise<Guide[]> {
  const guides: Guide[] = [];
  const slugs = new Set<string>();
  const budget = options.budget ?? { entries: 0, bytes: 0, guides: 0 };
  for (const key of ['entries', 'bytes', 'guides'] as const)
    if (!Number.isSafeInteger(budget[key]) || budget[key] < 0)
      throw new Error('Invalid guide read budget');
  const walk = async (path: string, depth = 0): Promise<void> => {
    if (depth > 24)
      throw new Error('Guide directory nesting exceeds 24 levels');
    const children = await readdir(path, { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (child.name.startsWith('.')) continue;
      if (++budget.entries > 25000)
        throw new Error('Guide directory exceeds 25000 entries');
      if (child.isSymbolicLink())
        throw new Error(`Guide symlinks are not supported: ${child.name}`);
      const file = await confinedPath(root, resolve(path, child.name));
      if (child.isDirectory()) {
        await walk(file, depth + 1);
        continue;
      }
      if (!/\.mdx?$/.test(child.name)) continue;
      if (options.only && !options.only.has(file)) continue;
      if (budget.guides >= 10000) throw new Error('Guide count exceeds 10000');
      const mdx = child.name.endsWith('.mdx');
      if (mdx && !options.trustContent)
        throw new Error(
          `${relative(root, file)}: MDX executes code. Review it and use --trust-content to opt in.`,
        );
      const raw = await readTextFile(file, 2 * 1024 * 1024);
      budget.bytes += Buffer.byteLength(raw);
      if (budget.bytes > 64 * 1024 * 1024)
        throw new Error('Guide sources exceed 64 MiB total');
      const match = /^---\r?\n((?:[^\r\n]*\r?\n)*?)---(?:\r?\n|$)/.exec(raw);
      let authored: unknown = {};
      if (match) {
        try {
          authored = parseSource(match[1] ?? '', relative(root, file)) ?? {};
        } catch (error) {
          throw new Error(
            `${relative(root, file)}: invalid frontmatter: ${error instanceof Error ? error.message : 'could not parse metadata'}`,
            { cause: error },
          );
        }
      }
      const metadata = frontmatter.safeParse(authored);
      if (!metadata.success)
        throw new Error(
          `${relative(root, file)}: invalid frontmatter: ${metadata.error.message}`,
        );
      const meta = metadata.data;
      const source = match ? raw.slice(match[0].length) : raw;
      const slug = relative(directoryPath, file)
        .replace(/\.mdx?$/, '')
        .split(/[\\/]/)
        .map(slugify)
        .join('/');
      if (slugs.has(slug)) throw new Error(`Guide slug collision: ${slug}`);
      slugs.add(slug);
      const rendered = await renderMarkdown(
        mdx
          ? await renderTrustedMdx(source, file, options.basePath ?? '')
          : source,
        mdx,
        {
          rewriteLink: (url) => {
            if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/.test(url)) return url;
            if (url.startsWith('/')) {
              const base = options.basePath ?? '';
              if (base && (url === base || url.startsWith(`${base}/`)))
                return url;
              return withBase(base, url);
            }
            const index = url.search(/[?#]/),
              path = index < 0 ? url : url.slice(0, index);
            if (!/\.mdx?$/.test(path)) return url;
            let decoded: string;
            try {
              decoded = decodeURIComponent(path);
            } catch {
              return url;
            }
            const target = relative(
              directoryPath,
              resolve(dirname(file), decoded),
            );
            if (
              target === '..' ||
              target.startsWith(`..${sep}`) ||
              target.startsWith(sep)
            )
              return url;
            const route = target
              .replace(/\.mdx?$/, '')
              .split(/[\\/]/)
              .map(slugify)
              .join('/');
            return (
              withBase(
                (options.basePath ?? '') + (options.localePrefix ?? ''),
                `/guides/${route}/`,
              ) + (index < 0 ? '' : url.slice(index))
            );
          },
        },
      );
      budget.guides++;
      guides.push({
        order: meta.order,
        slug,
        title:
          meta.title ??
          (
            rendered.headings.find((heading) => heading.level === 1)?.text ??
            child.name.replace(/\.mdx?$/, '')
          ).slice(0, 200),
        description: meta.description,
        group: meta.group,
        html: rendered.html,
        headings: rendered.headings,
        links: rendered.links,
        anchors: rendered.anchors,
        text: rendered.text,
        source: relative(root, file),
        sourceBytes: Buffer.byteLength(raw),
      });
    }
  };
  let directoryPath: string;
  try {
    directoryPath = await confinedPath(root, directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  await walk(directoryPath);
  return guides.sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title),
  );
}
