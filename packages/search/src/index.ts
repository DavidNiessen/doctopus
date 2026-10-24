import {
  guideHref,
  operationHref,
  guidesForLocale,
} from '@davidniessen/doctopus-contracts';
import type {
  SearchDocument,
  SearchResult,
  SiteData,
} from '@davidniessen/doctopus-contracts';

export function createSearchIndex(
  site: SiteData,
  locale = site.config.defaultLocale,
): SearchDocument[] {
  return [
    ...guidesForLocale(site, locale).map((guide) => ({
      id: guide.slug,
      title: guide.title,
      text: guide.text,
      href: guideHref(guide),
      group: guide.group,
      kind: 'guide' as const,
    })),
    ...site.apis.flatMap((api) =>
      api.operations.map((operation) => ({
        id: `${api.id}:${api.version}:${operation.slug}`,
        title: operation.summary,
        text: `${operation.method} ${operation.path} ${operation.description} ${operation.parameters.map((parameter) => `${parameter.name} ${parameter.description}`).join(' ')}`,
        href: operationHref(api, operation),
        group: operation.tags[0] ?? api.title,
        kind: 'operation' as const,
        method: operation.method,
        version: api.version,
      })),
    ),
  ];
}
function tokens(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .normalize('NFKD')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
export function search(
  index: SearchDocument[],
  query: string,
  filter?: { version?: string; kind?: string },
): SearchResult[] {
  const terms = tokens(query).slice(0, 12);
  if (!terms.length) return [];
  return index
    .filter(
      (entry) =>
        (!filter?.version || entry.version === filter.version) &&
        (!filter?.kind || entry.kind === filter.kind),
    )
    .map((entry) => {
      const title = entry.title.toLocaleLowerCase();
      const body = entry.text.toLocaleLowerCase();
      const titleWords = tokens(entry.title);
      let score = 0;
      for (const term of terms) {
        if (titleWords.includes(term)) score += 12;
        else if (title.includes(term)) score += 7;
        else if (
          titleWords.some(
            (word) => term.length > 3 && word.startsWith(term.slice(0, -1)),
          )
        )
          score += 3;
        else if (body.includes(term)) score += 1;
        else return { ...entry, score: 0, excerpt: '' };
      }
      const match = Math.max(0, body.indexOf(terms[0] ?? ''));
      return {
        ...entry,
        score,
        excerpt: entry.text
          .slice(Math.max(0, match - 40), match + 150)
          .replace(/\s+/g, ' '),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 30);
}
