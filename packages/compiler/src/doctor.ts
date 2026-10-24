import { checkExamples } from '@davidniessen/doctopus-spec';
import { renderMarkdown } from '@davidniessen/doctopus-content';
import {
  guideHref,
  operationHref,
  withBase,
  resolveSchema,
  lifecycleReport,
  lifecycleRoutes,
  localePaths,
  guidesForLocale,
  localizePath,
} from '@davidniessen/doctopus-contracts';
import type {
  Diagnostic,
  SiteData,
  Media,
  Schema,
  ApiDocument,
} from '@davidniessen/doctopus-contracts';
const codes = new Set([
  'operation-description',
  'operation-responses',
  'operation-tags',
  'operation-error-response',
  'operation-example',
  'operation-anonymous',
  'invalid-example',
  'example-schema-unsupported',
  'example-serialization-unsupported',
  'external-example',
  'broken-link',
  'broken-anchor',
  'invalid-link',
  'redirect-target',
  'redirect-collision',
  'doctor-unused-suppression',
  'doctor-unknown-rule',
  'lifecycle-replacement',
]);
const normalize = (path: string) => {
  const value = decodeURIComponent(path).replace(/\/index\.html$/, '/');
  return /\.[a-z0-9]+$/i.test(value)
    ? value
    : value.endsWith('/')
      ? value
      : `${value}/`;
};
function authored(
  schema: Schema,
  api: ApiDocument,
  consume: () => void,
  seen = new WeakSet<Schema>(),
  depth = 0,
): boolean {
  consume();
  if (depth > 64)
    throw new Error(
      'Doctor coverage exceeds schema depth 64; simplify the schema',
    );
  if (seen.has(schema)) return false;
  seen.add(schema);
  const actual = resolveSchema(schema, api.schemas);
  if (
    Object.hasOwn(actual, 'example') ||
    (Array.isArray(actual.examples) && actual.examples.length > 0)
  )
    return true;
  for (const key of ['properties', '$defs'])
    for (const value of Object.values(
      (actual[key] ?? {}) as Record<string, Schema>,
    ))
      if (
        value &&
        typeof value === 'object' &&
        authored(value, api, consume, seen, depth + 1)
      )
        return true;
  for (const key of ['oneOf', 'anyOf', 'allOf'])
    if (
      Array.isArray(actual[key]) &&
      (actual[key] as Schema[]).some((value) =>
        authored(value, api, consume, seen, depth + 1),
      )
    )
      return true;
  return (
    !!actual.items &&
    typeof actual.items === 'object' &&
    authored(actual.items as Schema, api, consume, seen, depth + 1)
  );
}
/** Offline quality checks over a compiled publication. This makes no target API requests. */
export async function auditDocumentation(
  site: SiteData,
): Promise<Diagnostic[]> {
  const diagnostics = [...site.diagnostics];
  if (diagnostics.length > 10_000)
    throw new Error(
      'Doctor exceeds 10,000 diagnostics; fix existing findings first',
    );
  let coverageNodes = 0,
    linkNodes = 0;
  const consume = () => {
    if (++coverageNodes > 500_000)
      throw new Error(
        'Doctor coverage exceeds 500,000 schema nodes; split the project',
      );
  };
  const add = (
    code: string,
    source: string,
    message: string,
    severity: Diagnostic['severity'] = 'warning',
  ) => {
    if (diagnostics.length >= 10_000)
      throw new Error(
        'Doctor exceeds 10,000 diagnostics; split the project or fix its highest-volume findings',
      );
    diagnostics.push({ code, severity, source, message });
  };
  const base = site.config.basePath;
  const origin = site.config.siteUrl ?? 'https://doctopus.invalid';
  const routes = new Map<string, Set<string> | undefined>();
  for (const route of lifecycleRoutes(site))
    routes.set(normalize(withBase(base, route)), new Set(['main-content']));
  const defaultGuides = new Set(site.guides);
  const guideMetadata = new Map<
    SiteData['guides'][number],
    {
      links: NonNullable<SiteData['guides'][number]['links']>;
      anchors: string[];
    }
  >();
  for (const guide of [
    ...site.guides,
    ...Object.values(site.guideTranslations ?? {}).flat(),
  ]) {
    const data =
      guide.links && guide.anchors
        ? { links: guide.links, anchors: guide.anchors }
        : await renderMarkdown(guide.html, true);
    guideMetadata.set(guide, data);
    if (defaultGuides.has(guide))
      routes.set(
        normalize(withBase(base, guideHref(guide))),
        new Set(['main-content', ...data.anchors]),
      );
  }
  for (const api of site.apis) {
    const examples = await checkExamples(api);
    if (diagnostics.length + examples.length > 10_000)
      throw new Error('Doctor exceeds 10,000 diagnostics; split the project');
    diagnostics.push(...examples);
    for (const operation of api.operations) {
      const anchors = new Set(['main-content', 'responses']);
      if (operation.security.length) anchors.add('authentication');
      if (operation.requestBody) anchors.add('request-body');
      for (const parameter of operation.parameters)
        anchors.add(`${parameter.in}-parameters`);
      routes.set(
        normalize(withBase(base, operationHref(api, operation))),
        anchors,
      );
      if (!operation.tags.length)
        add(
          'operation-tags',
          operation.source,
          'Operation has no tag; assign a reader navigation group.',
        );
      if (
        !operation.responses.some(
          (response) =>
            /^[45]/.test(response.status) || response.status === 'default',
        )
      )
        add(
          'operation-error-response',
          operation.source,
          'Operation documents no error response or default response.',
        );
      if (
        operation.security.length > 1 &&
        operation.security.some(
          (requirement) => Object.keys(requirement).length === 0,
        )
      )
        add(
          'operation-anonymous',
          operation.source,
          'Operation permits anonymous access alongside authenticated alternatives; confirm this is intentional.',
        );
      const media = [
        ...Object.values(operation.requestBody?.content ?? {}),
        ...operation.responses.flatMap((response) =>
          Object.values(response.content),
        ),
      ];
      const hasExample = (item: Media) =>
        Object.hasOwn(item, 'example') ||
        Object.keys(item.examples ?? {}).length > 0 ||
        authored(item.schema, api, consume);
      if (media.length && !media.some(hasExample))
        add(
          'operation-example',
          operation.source,
          'Operation payloads have no authored example; generated defaults may not represent a real request or response.',
        );
    }
  }
  const root = site.guides[0]
    ? withBase(base, guideHref(site.guides[0]))
    : site.apis[0]?.operations[0]
      ? withBase(base, operationHref(site.apis[0], site.apis[0].operations[0]))
      : '';
  routes.set(
    normalize(withBase(base, '/')),
    routes.get(root) ?? new Set(['main-content']),
  );
  for (const [route, anchors] of [...routes]) {
    const page = route.slice(base.length) || '/';
    for (const localized of localePaths(site.config, page))
      routes.set(normalize(withBase(base, localized)), anchors);
  }
  for (const locale of Object.keys(site.guideTranslations ?? {})) {
    const guides = guidesForLocale(site, locale);
    for (const guide of guides)
      routes.set(
        normalize(
          withBase(base, localizePath(site.config, guideHref(guide), locale)),
        ),
        new Set(['main-content', ...guideMetadata.get(guide)!.anchors]),
      );
    if (guides[0])
      routes.set(
        normalize(withBase(base, localizePath(site.config, '/', locale))),
        new Set(['main-content', ...guideMetadata.get(guides[0])!.anchors]),
      );
  }
  for (const asset of site.assetMetadata ?? [])
    routes.set(normalize(withBase(base, `/media/${asset.path}`)), undefined);
  routes.set(normalize(withBase(base, '/robots.txt')), undefined);
  routes.set(
    normalize(withBase(base, '/oauth/callback/')),
    new Set(['main-content']),
  );
  if (site.config.siteUrl && site.config.seo?.index !== false)
    routes.set(normalize(withBase(base, '/sitemap.xml')), undefined);
  for (const [from, to] of Object.entries(site.config.redirects)) {
    const source = normalize(withBase(base, from)),
      target = normalize(withBase(base, to));
    if (routes.has(source))
      add(
        'redirect-collision',
        `config:redirects:${from}`,
        'Redirect replaces an existing publication route.',
        'error',
      );
    else if (!routes.has(target))
      add(
        'redirect-target',
        `config:redirects:${from}`,
        'Redirect target is not a published page.',
        'error',
      );
    else routes.set(source, routes.get(target));
  }
  const linkGroups: {
    href: string;
    source: string;
    exactSource?: boolean;
    links: { url: string; kind: 'link' | 'image' }[];
  }[] = site.guides.map((guide) => ({
    href: withBase(base, guideHref(guide)),
    source: guide.source,
    links: guideMetadata.get(guide)!.links,
  }));
  for (const [locale, guides] of Object.entries(site.guideTranslations ?? {}))
    for (const guide of guides)
      linkGroups.push({
        href: withBase(
          base,
          localizePath(site.config, guideHref(guide), locale),
        ),
        source: guide.source,
        links: guideMetadata.get(guide)!.links,
      });
  // Replacement and link checks are independent of today's date.
  const lifecycle = lifecycleReport(site, { asOf: '1970-01-01' });
  for (const entry of lifecycle.entries) {
    if (entry.replacementIssue)
      add(
        'lifecycle-replacement',
        `${entry.source}/x-doctopus-lifecycle/replacement`,
        `Replacement target is ${entry.replacementIssue}; use an unambiguous published operation or a migration URL.`,
      );
    if (entry.lifecycle.migrationUrl)
      linkGroups.push({
        href: withBase(base, entry.href),
        source: `${entry.source}/x-doctopus-lifecycle/migrationUrl`,
        exactSource: true,
        links: [
          {
            kind: 'link',
            url: entry.lifecycle.migrationUrl.startsWith('/')
              ? withBase(base, entry.lifecycle.migrationUrl)
              : entry.lifecycle.migrationUrl,
          },
        ],
      });
  }
  for (const group of linkGroups) {
    const links = group.links;
    for (let index = 0; index < links.length; index++) {
      if (++linkNodes > 100_000)
        throw new Error('Doctor exceeds 100,000 links; split the project');
      const link = links[index]!,
        source = group.exactSource
          ? group.source
          : `${group.source}#links/${index}`;
      if (/^(?:mailto:|tel:|data:)/i.test(link.url)) continue;
      let target: URL, path: string;
      try {
        target = new URL(link.url, new URL(group.href, origin));
        if (target.origin !== origin) continue;
        path = normalize(target.pathname);
      } catch {
        add(
          'invalid-link',
          source,
          'Local link has malformed URL or percent encoding.',
          'error',
        );
        continue;
      }
      if (target.origin !== origin) continue;
      if (!routes.has(path)) {
        add(
          'broken-link',
          source,
          'Local link or image does not resolve to a published route or asset. URL query values are omitted.',
          'error',
        );
        continue;
      }
      if (
        link.kind === 'image' &&
        !/\.(?:png|jpe?g|webp|gif|avif|ico)$/i.test(path)
      ) {
        add(
          'broken-link',
          source,
          'Local image points to a resource that is not a supported raster image.',
          'error',
        );
        continue;
      }
      if (!target.hash || !routes.get(path)) continue;
      let anchor: string;
      try {
        anchor = decodeURIComponent(target.hash.slice(1)).split(':~:text=')[0]!;
      } catch {
        add(
          'invalid-link',
          source,
          'Local fragment has malformed percent encoding.',
          'error',
        );
        continue;
      }
      if (
        anchor &&
        anchor.toLowerCase() !== 'top' &&
        !routes.get(path)!.has(anchor)
      )
        add(
          'broken-anchor',
          source,
          'Local link points to a missing fragment in its target page.',
          'error',
        );
    }
  }
  if (diagnostics.length > 10_000)
    throw new Error(
      'Doctor exceeds 10,000 diagnostics; split the project or fix its highest-volume findings',
    );
  const known = new Set([
    ...codes,
    ...site.diagnostics.map((diagnostic) => diagnostic.code),
  ]);
  for (const code of Object.keys(site.config.doctor?.rules ?? {}))
    if (!known.has(code))
      add(
        'doctor-unknown-rule',
        `config:doctor:rules:${code}`,
        'Configured doctor rule is unknown; check for a typo.',
      );
  const suppressions = site.config.doctor?.suppressions ?? [];
  const used = new Set<number>();
  const result = diagnostics.flatMap((diagnostic) => {
    const suppression = suppressions.findIndex(
      (item) =>
        item.code === diagnostic.code && item.source === diagnostic.source,
    );
    if (suppression >= 0) {
      used.add(suppression);
      return [];
    }
    const severity =
      site.config.doctor?.rules[diagnostic.code] ?? diagnostic.severity;
    return severity === 'off' ? [] : [{ ...diagnostic, severity }];
  });
  suppressions.forEach((_item, index) => {
    const severity =
      site.config.doctor?.rules['doctor-unused-suppression'] ?? 'warning';
    if (!used.has(index) && severity !== 'off')
      result.push({
        code: 'doctor-unused-suppression',
        severity,
        source: `config:doctor:suppressions:${index}`,
        message:
          'Suppression matches no finding; remove it or update its exact source.',
      });
  });
  if (result.length > 10_000)
    throw new Error(
      'Doctor exceeds 10,000 diagnostics; remove stale policy entries',
    );
  return result.sort(
    (a, b) =>
      (a.source ?? '').localeCompare(b.source ?? '', 'en') ||
      a.code.localeCompare(b.code, 'en'),
  );
}
