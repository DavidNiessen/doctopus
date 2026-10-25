import validateSchema from './schema-meta-validator.cjs';
import { normalizeDocument } from './normalize-document.js';
import { parseSource, pointerValue, record, text } from './portable-source.js';
import { slugify } from '@davidniessen/doctopus-contracts';

/** Normalize a self-contained spec without filesystem access, network or eval. */
export function parseBrowserSpec(source: string, documentUrl: string) {
  const document = record(parseSource(source, 'OpenAPI document'));
  if (!/^3\.(0|1)\.\d+$/.test(text(document.openapi)))
    throw new Error('Use an OpenAPI 3.0 or 3.1 document.');
  const info = record(document.info);
  if (!text(info.title).trim() || !text(info.version).trim())
    throw new Error('The OpenAPI document needs info.title and info.version.');
  if (!document.paths && !document.webhooks && !document.components)
    throw new Error(
      'The OpenAPI document needs paths, webhooks or components.',
    );
  const pending: unknown[] = [document];
  for (let index = 0; index < pending.length; index++) {
    const value = pending[index];
    if (!value || typeof value !== 'object') continue;
    const ref = record(value).$ref;
    if (typeof ref === 'string') {
      if (!ref.startsWith('#/'))
        throw new Error(
          'Direct mode requires a self-contained specification with local references. Bundle external references first.',
        );
      pointerValue(document, ref);
    }
    pending.push(...Object.values(value));
  }
  const api = normalizeDocument(
    document,
    {
      id: 'api',
      path: 'OpenAPI document',
      version: slugify(text(info.version)) || 'v1',
    },
    (schema) => {
      if (!validateSchema(schema))
        throw new Error(
          'The OpenAPI document contains an invalid JSON Schema.',
        );
    },
  );
  const resolve = (server: string) => {
    const url = new URL(server, documentUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(
        'API servers must use HTTP or HTTPS without URL credentials.',
      );
    return url.href;
  };
  api.servers = (api.servers.length ? api.servers : ['/']).map(resolve);
  for (const operation of api.operations)
    operation.servers = (
      operation.servers.length ? operation.servers : api.servers
    ).map(resolve);
  return api;
}
