export interface DirectDocumentationOptions {
  /** Browser-visible OpenAPI URL, resolved relative to the documentation mount. */
  url?: string;
  /** Visible header title and browser-tab site name. Defaults to the API title. */
  title?: string;
  description?: string;
  theme?: 'violet' | 'mint' | 'ocean' | 'neutral' | 'ember' | 'contrast';
  layout?: 'modern' | 'classic';
  appearance?: 'system' | 'light' | 'dark';
  logo?: string;
  logoDark?: string;
  favicon?: string;
}
export interface DirectDocumentationConfig extends DirectDocumentationOptions {
  basePath: string;
  url: string;
  theme: 'violet' | 'mint' | 'ocean' | 'neutral' | 'ember' | 'contrast';
  layout: 'modern' | 'classic';
  appearance: 'system' | 'light' | 'dark';
}
export function directDocumentationConfig(
  options: DirectDocumentationOptions,
  basePath: string,
): DirectDocumentationConfig {
  if (basePath !== '' && !/^\/[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(basePath))
    throw new Error(
      'Documentation mount must be / or a path without a trailing slash.',
    );
  if (basePath.endsWith('/'))
    throw new Error('Documentation mount must not end with /.');
  const result: DirectDocumentationConfig = {
    basePath,
    url: options.url ?? '/openapi.json',
    theme: options.theme ?? 'violet',
    layout: options.layout ?? 'modern',
    appearance: options.appearance ?? 'system',
  };
  if (
    !['violet', 'mint', 'ocean', 'neutral', 'ember', 'contrast'].includes(
      result.theme,
    ) ||
    !['modern', 'classic'].includes(result.layout) ||
    !['system', 'light', 'dark'].includes(result.appearance)
  )
    throw new Error('Unsupported documentation theme, layout or appearance.');
  for (const key of ['url', 'logo', 'logoDark', 'favicon'] as const) {
    const value = key === 'url' ? result.url : options[key];
    if (value === undefined) continue;
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 4096 ||
      value.includes('\\') ||
      /\s/.test(value) ||
      [...value].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw new Error(`Invalid documentation ${key}.`);
    const url = new URL(value, 'https://doctopus.invalid/docs/');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error(
        `Documentation ${key} must be an HTTP(S) or relative URL without credentials or a fragment.`,
      );
    result[key] = value;
  }
  for (const [key, limit] of [
    ['title', 100],
    ['description', 500],
  ] as const) {
    const value = options[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || !value.trim() || value.length > limit)
        throw new Error(`Invalid documentation ${key}.`);
      result[key] = value;
    }
  }
  if (result.logoDark && !result.logo)
    throw new Error('A dark logo requires a default logo.');
  return result;
}
/** Only UI routes get the shell; missing assets and unrelated host routes do not. */
export function isDirectDocumentationRoute(path: string): boolean {
  return (
    path === '' ||
    path === '/' ||
    path === '/index.html' ||
    /^\/api\/[^/.][^/]*\/[^/.][^/]*\/[^/.][^/]*\/?$/.test(path)
  );
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
}
export function encodeHtmlJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<\u2028\u2029]/g,
    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}
