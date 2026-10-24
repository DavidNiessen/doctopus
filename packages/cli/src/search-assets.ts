import { createSearchIndex } from '@davidniessen/doctopus-search';
import type { SiteData } from '@davidniessen/doctopus-contracts';
/** Stream one corpus at a time while retaining legacy default search paths. */
export function* searchAssets(site: SiteData): Generator<[string, string]> {
  for (const locale of [
    site.config.defaultLocale,
    ...Object.keys(site.guideTranslations ?? {}),
  ]) {
    const index = createSearchIndex(site, locale);
    const root =
      locale === site.config.defaultLocale ? 'search' : `search/${locale}`;
    const shards: string[] = [];
    yield [
      locale === site.config.defaultLocale
        ? 'search.json'
        : `${root}/index.json`,
      JSON.stringify(index),
    ];
    for (let offset = 0; offset < index.length; offset += 500) {
      const path = `${root}/${offset / 500}.json`;
      shards.push(path);
      yield [path, JSON.stringify(index.slice(offset, offset + 500))];
    }
    yield [
      locale === site.config.defaultLocale
        ? 'search-manifest.json'
        : `${root}/catalog.json`,
      JSON.stringify({ schemaVersion: 1, records: index.length, shards }),
    ];
  }
}
