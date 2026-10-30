import { renderToString } from 'react-dom/server';
import { App } from './components/App.js';
import {
  createPageData,
  pageMetadata,
  toolVersion,
  localeRoute,
  encodeHtmlJson,
} from '@davidniessen/doctopus-contracts';
import type { SiteData } from '@davidniessen/doctopus-contracts';
export function renderDocument(
  site: SiteData,
  path: string,
  options: { status?: number; title?: string } = {},
): string {
  const page = createPageData(site, path);
  const encoded = JSON.stringify(page).replace(
    /[<\u2028\u2029]/g,
    (char) =>
      String.fromCharCode(92) +
      'u' +
      char.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  const markup = renderToString(<App site={page} initialPath={path} />);
  const escape = (value: string): string =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char] ?? char,
    );
  const metadata = pageMetadata(page, path);
  const title = `${options.title ?? metadata.title} · ${site.config.name}`;
  const canonical =
    options.status !== 404 && metadata.canonical
      ? `<link rel="canonical" href="${escape(metadata.canonical)}"><meta property="og:url" content="${escape(metadata.canonical)}">`
      : '';
  const alternates =
    options.status !== 404 && site.config.siteUrl
      ? metadata.alternates
          .map(
            (item) =>
              `<link rel="alternate" hreflang="${escape(item.locale)}" href="${escape(site.config.siteUrl! + site.config.basePath + item.href)}" data-doc-locale>`,
          )
          .join('')
      : '';
  const image = metadata.image
    ? `<meta property="og:image" content="${escape(metadata.image)}">`
    : '';
  const favicon = site.config.favicon
    ? `<link rel="icon" href="${site.config.basePath}/media/${escape(site.config.favicon)}">`
    : `<link rel="icon" type="image/svg+xml" href="${site.config.basePath}/assets/doctopus-icon.svg">`;
  const stylesheet = site.config.theme.stylesheet
    ? `<link rel="stylesheet" href="${site.config.basePath}/media/${escape(site.config.theme.stylesheet)}">`
    : '';
  const appearance = encodeHtmlJson({
    basePath: site.config.basePath,
    theme: site.config.theme,
  });
  return `<!doctype html><html lang="${escape(localeRoute(site.config, path).locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="description" content="${escape(metadata.description)}"><meta name="robots" content="${options.status === 404 ? 'noindex,nofollow' : metadata.robots}"><meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(metadata.description)}"><meta name="twitter:card" content="${metadata.image ? 'summary_large_image' : 'summary'}">${canonical}${alternates}${image}${favicon}<meta name="generator" content="doctopus ${toolVersion}"><title>${escape(title)}</title><link rel="stylesheet" href="${site.config.basePath}/assets/reader.css">${stylesheet}<script type="application/json" id="doctopus-appearance">${appearance}</script><script src="${site.config.basePath}/assets/theme.js"></script></head><body><div id="root">${markup}</div><script type="application/json" id="docs-data">${encoded}</script><script type="module" src="${site.config.basePath}/assets/reader.js"></script></body></html>`;
}
