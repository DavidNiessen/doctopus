export type HttpMethod =
  'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace';
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = Record<string, unknown>;
export interface Diagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  source?: string;
}
export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  description: string;
  schema: Schema;
  style?: string;
  explode?: boolean;
  example?: unknown;
  examples?: Record<string, unknown>;
  content?: Record<string, Media>;
  allowReserved?: boolean;
  deprecated?: boolean;
}
export interface Media {
  schema: Schema;
  encoding?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, unknown>;
}
export interface ApiResponse {
  status: string;
  description: string;
  content: Record<string, Media>;
  headers: Record<string, unknown>;
}
export type OperationKind = 'endpoint' | 'webhook' | 'callback';
export interface OperationLifecycle {
  deprecatedOn?: string;
  sunsetOn?: string;
  migrationUrl?: string;
  message?: string;
  replacement?: {
    apiId?: string;
    version?: string;
    kind?: OperationKind;
    operationId: string;
  };
}
export interface Operation {
  codeSamples?: CodeSample[];
  kind?: OperationKind;
  lifecycle?: OperationLifecycle;
  callback?: { operationId: string; name: string; expression: string };
  externalDocs?: { url: string; description?: string };
  id: string;
  slug: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  deprecated: boolean;
  parameters: Parameter[];
  requestBody?: {
    required: boolean;
    description: string;
    content: Record<string, Media>;
  };
  responses: ApiResponse[];
  security: Record<string, string[]>[];
  servers: string[];
  source: string;
}
/** Reviewed static build output, independent of live playground inputs. */
export interface CodeSample {
  plugin: string;
  id: string;
  label: string;
  language: string;
  code: string;
}
export interface SecurityScheme {
  type: string;
  description?: string;
  scheme?: string;
  name?: string;
  in?: string;
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
}
export interface ApiDocument {
  operationIndex?: string;
  openapiVersion?: string;
  id: string;
  version: string;
  title: string;
  description: string;
  source: string;
  operations: Operation[];
  schemas: Record<string, Schema>;
  securitySchemes: Record<string, SecurityScheme>;
  diagnostics: Diagnostic[];
  servers: string[];
}
export interface Guide {
  links?: { url: string; kind: 'link' | 'image' }[];
  anchors?: string[];
  sourceBytes?: number;
  order: number;
  slug: string;
  title: string;
  description: string;
  group: string;
  html: string;
  text: string;
  headings: { id: string; text: string; level: number }[];
  source: string;
}
export interface Palette {
  background: string;
  surface: string;
  subtle: string;
  border: string;
  text: string;
  muted: string;
  heading: string;
}
export interface Theme {
  preset?: 'mint' | 'ocean' | 'violet' | 'neutral';
  colors?: { light?: Partial<Palette>; dark?: Partial<Palette> };
  sidebarWidth?: number;
  contentWidth?: number;
  stylesheet?: string;
  accent: string;
  radius: number;
  font: string;
  codeTheme: 'dark' | 'light';
  density: 'comfortable' | 'compact';
}
export interface ReaderExtensionAsset {
  id: string;
  entry: string;
  digest: string;
}
export interface ProjectConfig {
  readerExtensions?: { id: string; entry: string; files?: string[] }[];
  i18n?: import('./i18n.js').UiConfiguration;
  feedback?: { url: string; label?: string; includePage?: boolean };
  explorer?: {
    mode?: 'live' | 'mock';
    relay?: string;
    credentialReuse?: boolean;
    oauthClients?: Record<
      string,
      Record<string, { clientId: string; issuer: string }>
    >;
  };
  doctor?: {
    rules: Record<string, 'off' | 'warning' | 'error'>;
    suppressions: { code: string; source: string; reason: string }[];
  };
  schemaVersion: 1;
  name: string;
  description: string;
  basePath: string;
  logo?: string;
  logoDark?: string;
  favicon?: string;
  assets?: string;
  siteUrl?: string;
  seo?: { index: boolean; socialImage?: string };
  specs: { id: string; path: string; version?: string; references?: string }[];
  guides: string;
  theme: Theme;
  links: { label: string; href: string }[];
  redirects: Record<string, string>;
  locales: string[];
  defaultLocale: string;
  plugins: string[];
}
export interface SiteData {
  readerExtensions?: ReaderExtensionAsset[];
  /** Full compiler graph only; omitted from route-scoped payloads. */
  guideTranslations?: Record<string, Guide[]>;
  /** Language of the active authored content in route-scoped payloads. */
  contentLocale?: string;
  searchLocale?: string;
  pageTranslations?: { locale: string; href: string }[];
  /** Route-scoped render data; absent from the compiler's full graph. */
  pagePath?: string;
  lifecycle?: import('./lifecycle-pages.js').LifecycleContext;
  assetMetadata?: { path: string; hash: string }[];
  navigationTotal?: number;
  navigationTruncated?: boolean;
  pluginVersions?: {
    name: string;
    version: string;
    sourceDigest?: string;
    inputs?: { path: string; digest: string }[];
  }[];
  schemaVersion: 1;
  config: ProjectConfig;
  apis: ApiDocument[];
  guides: Guide[];
  diagnostics: Diagnostic[];
}
export interface SearchDocument {
  id: string;
  title: string;
  text: string;
  href: string;
  group: string;
  kind: 'guide' | 'operation';
  method?: HttpMethod;
  version?: string;
}
export interface SearchResult extends SearchDocument {
  score: number;
  excerpt: string;
}
export interface ArtifactManifest {
  artifactDigest: string;
  schemaVersion: 1 | 2;
  compilerVersion: string;
  inputDigest: string;
  files: Record<string, string>;
  routes: string[];
  diagnostics: Diagnostic[];
  plugins: NonNullable<SiteData['pluginVersions']>;
}

export const methods: HttpMethod[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
];
export function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'page'
  );
}
export function operationHref(
  api: ApiDocument,
  operation: Pick<Operation, 'slug'>,
): string {
  return `/api/${encodeURIComponent(api.id)}/${encodeURIComponent(api.version)}/${operation.slug}/`;
}
export function guideHref(guide: Guide): string {
  return `/guides/${guide.slug}/`;
}
export function withBase(base: string, path: string): string {
  return navigationHref(
    `${base}${path.startsWith('/') ? path : `/${path}`}`,
    true,
  );
}

const navigationOrigin = 'https://doctopus.invalid';
function navigationHref(value: string, localOnly: boolean): string {
  try {
    const url = new URL(value, navigationOrigin + '/');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '#';
    if (
      url.username ||
      url.password ||
      (localOnly && url.origin !== navigationOrigin)
    )
      return '#';
    // A normalized pathname can start with // after dot-segment removal.
    // Emit exactly one leading slash so a second URL parse cannot select another host.
    const normalized =
      url.origin !== navigationOrigin
        ? url.href
        : value.startsWith('#')
          ? url.hash
          : '/' + url.pathname.replace(/^\/+/, '') + url.search + url.hash;
    // Encode unsafe URI text while preserving already encoded path/query values.
    return encodeURI(normalized).replace(/%25([a-f0-9]{2})/gi, '%$1');
  } catch {
    return '#';
  }
}
/** Guard navigation read from page data, including local fragments and HTTP(S) links. */
export function safeNavigationHref(value: string): string {
  return navigationHref(value, false);
}

export { resolveSchema, exampleFor } from './schema.js';
export { objectFieldSchema } from './object-fields.js';
export { resolveHeaderObject } from './headers.js';

export {
  createPageData,
  createPageDataFactory,
  normalizePagePath,
} from './page.js';
export { toolVersion } from './version.js';
export { lifecycleContext, lifecycleRoutes } from './lifecycle-pages.js';
export type {
  LifecycleContext,
  LifecycleGroup,
  LifecyclePage,
  LifecycleRecord,
} from './lifecycle-pages.js';

export {
  contrastRatio,
  readableAccent,
  resolvePalette,
  themePresets,
} from './theme.js';

export { pageMetadata } from './metadata.js';
export { feedbackHref, safeFeedbackUrl } from './feedback.js';
export {
  exampleChoices,
  formatExample,
  isJsonMediaType,
  hasExternalExamples,
} from './examples.js';
export type { ExampleChoice } from './examples.js';
export { parseJsonValue, serializeJsonValue, setJsonProperty } from './json.js';
export type { JsonValueNode } from './json.js';
export {
  isCalendarDate,
  lifecycleIssues,
  parseOperationLifecycle,
  lifecycleReport,
} from './lifecycle.js';
export type {
  LifecycleEntry,
  LifecycleReport,
  LifecycleStatus,
} from './lifecycle.js';

/** Explicit same-origin management endpoint; never a spec-selected remote URL. */
export function isRelayEndpoint(value: string): boolean {
  return (
    value.length <= 160 &&
    /^\/api\/projects\/[a-z0-9][a-z0-9-]{0,62}\/relay$/.test(value)
  );
}

export {
  defaultUiMessages,
  createUiTranslation,
  validUiMessage,
} from './i18n.js';
export type {
  UiMessageKey,
  UiMessages,
  UiConfiguration,
  UiText,
  UiTranslation,
} from './i18n.js';

export {
  localeRoute,
  localizePath,
  localePaths,
  localeName,
} from './locale.js';

export {
  guidesForLocale,
  pageContentLocale,
  guideAlternates,
  validateGuideTranslations,
} from './guide-translations.js';

export { schemaVariants } from './schema-variants.js';
export type { SchemaVariant, SchemaVariants } from './schema-variants.js';

export {
  defaultIsolatedBuildLimits,
  isImmutableBuilderImage,
  isVisibleBuildConfig,
  readIsolatedBuildLimits,
  readSourceSnapshotInfo,
  readBuildPolicy,
} from './builds.js';
export type {
  IsolatedBuildLimits,
  SourceSnapshotInfo,
  BuildPolicy,
} from './builds.js';
