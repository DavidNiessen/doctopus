import {
  methods,
  slugify,
  parseOperationLifecycle,
  resolveHeaderObject,
} from '@davidniessen/doctopus-contracts';
import { validateSchemaBoundaries } from './schema-boundaries.js';
import type {
  ApiDocument,
  Diagnostic,
  Media,
  Operation,
  Parameter,
  Schema,
  SecurityScheme,
} from '@davidniessen/doctopus-contracts';
import {
  record,
  text,
  array,
  resolvePointer,
  pointerEscape,
  pointerValue,
} from './portable-source.js';

function namedExamples(
  document: unknown,
  input: unknown,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record(input)).map(([name, example]) => [
      name,
      resolvePointer(document, example),
    ]),
  );
}
function normalizedHeader(
  document: unknown,
  input: unknown,
  depth = 0,
): Record<string, unknown> {
  const header = resolveHeaderObject(
    input,
    (reference) => pointerValue(document, reference),
    text(record(document).openapi).startsWith('3.0'),
  );
  return {
    ...header,
    ...(typeof header.schema === 'boolean'
      ? { schema: { 'x-doctopus-boolean-schema': header.schema } }
      : {}),
    ...(header.examples === undefined
      ? {}
      : { examples: namedExamples(document, header.examples) }),
    ...(header.content === undefined
      ? {}
      : { content: content(document, header.content, depth + 1) }),
  };
}
function normalizedEncoding(
  document: unknown,
  input: unknown,
  depth: number,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record(input)).map(([field, value]) => {
      const encoding = record(value);
      return [
        field,
        {
          ...encoding,
          ...(encoding.headers === undefined
            ? {}
            : {
                headers: Object.fromEntries(
                  Object.entries(record(encoding.headers)).map(
                    ([name, header]) => [
                      name,
                      normalizedHeader(document, header, depth),
                    ],
                  ),
                ),
              }),
        },
      ];
    }),
  );
}
function content(
  document: unknown,
  input: unknown,
  depth = 0,
): Record<string, Media> {
  if (depth > 8)
    throw new Error('Media and Header Object nesting exceeds eight levels');
  return Object.fromEntries(
    Object.entries(record(input)).map(([type, value]) => {
      const media = resolvePointer(document, value);
      return [
        type,
        {
          schema:
            typeof media.schema === 'boolean'
              ? { 'x-doctopus-boolean-schema': media.schema }
              : record(media.schema),
          ...(media.encoding === undefined
            ? {}
            : {
                encoding: normalizedEncoding(document, media.encoding, depth),
              }),
          ...(media.example === undefined ? {} : { example: media.example }),
          ...(media.examples === undefined
            ? {}
            : {
                examples: namedExamples(document, media.examples),
              }),
        },
      ];
    }),
  );
}
function servers(input: unknown, fallback: string[]): string[] {
  if (input === undefined) return fallback;
  return array(input).map((item) => {
    const server = record(item);
    return text(server.url).replace(/\{([^}]+)\}/g, (_, name: string) =>
      text(record(record(server.variables)[name]).default),
    );
  });
}
/** Keep references rather than expanding recursive graphs into a JSON tree. */
function schemaRegistry(
  document: unknown,
  operations: Operation[],
): Record<string, Schema> {
  const result = Object.fromEntries(
    Object.entries(record(record(record(document).components).schemas)).map(
      ([name, value]) => [
        name,
        typeof value === 'boolean'
          ? { 'x-doctopus-boolean-schema': value }
          : record(value),
      ],
    ),
  );
  const queue: unknown[] = [operations, ...Object.values(result)];
  const visited = new WeakSet<object>();
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);
    if (i > 2_000_000) throw new Error('Schema graph exceeds its node budget');
    const object = record(node);
    if (typeof object.$ref === 'string') {
      const ref = object.$ref;
      const target = pointerValue(document, ref);
      const component =
        ref.startsWith('#/components/schemas/') &&
        !ref.slice('#/components/schemas/'.length).includes('/')
          ? decodeURIComponent(ref.slice('#/components/schemas/'.length))
              .replace(/~1/g, '/')
              .replace(/~0/g, '~')
          : undefined;
      if (
        !(component !== undefined && Object.hasOwn(result, component)) &&
        !Object.hasOwn(result, ref)
      ) {
        result[ref] =
          typeof target === 'boolean'
            ? { 'x-doctopus-boolean-schema': target }
            : record(target);
        queue.push(target);
      }
    }
    queue.push(...Object.values(node));
  }
  return result;
}
export function normalizeDocument(
  document: Record<string, unknown>,
  input: { id: string; path: string; version?: string },
  validateSchema: (schema: Record<string, unknown>, source: string) => void,
): ApiDocument {
  const info = record(document.info);
  const diagnostics: Diagnostic[] = [];
  const rootServers = servers(document.servers, []);
  const operations: Operation[] = [];
  const slugs = new Set<string>();
  const declaredIds = new Set<string>();
  const pathTemplates = new Set<string>();
  const securitySchemes = Object.fromEntries(
    Object.entries(record(record(document.components).securitySchemes)).map(
      ([name, value]) => [name, resolvePointer(document, value)],
    ),
  ) as unknown as Record<string, SecurityScheme>;
  function pathItem(
    path: string,
    raw: unknown,
    source: string,
    kind: 'endpoint' | 'webhook' | 'callback',
    parent?: { operationId: string; name: string; expression: string },
    depth = 0,
  ) {
    if (depth > 8)
      throw new Error(`${source}: callback nesting exceeds 8 levels`);
    const item = resolvePointer(document, raw);
    for (const method of methods) {
      if (!item[method]) continue;
      const operation = record(item[method]);
      let lifecycle: Operation['lifecycle'];
      if (operation['x-doctopus-lifecycle'] !== undefined) {
        try {
          lifecycle = parseOperationLifecycle(
            operation['x-doctopus-lifecycle'],
          );
        } catch (error) {
          throw new Error(
            `${source}/${method}/x-doctopus-lifecycle: ${error instanceof Error ? error.message : 'Invalid lifecycle metadata'}`,
            { cause: error },
          );
        }
      }
      const declaredId = text(operation.operationId);
      if (declaredId && kind !== 'callback') {
        if (declaredIds.has(declaredId))
          throw new Error(`Duplicate operationId: ${declaredId}`);
        declaredIds.add(declaredId);
      }
      const id =
        kind === 'endpoint'
          ? text(operation.operationId, `${method}-${path}`)
          : `${kind}-${parent?.operationId ?? ''}-${parent?.name ?? ''}-${text(operation.operationId, `${method}-${path}`)}`;
      let slug = slugify(id);
      if (slugs.has(slug)) slug = slugify(`${id}-${method}-${path}`);
      if (slugs.has(slug))
        throw new Error(`Duplicate operation route: ${slug}`);
      slugs.add(slug);
      const byKey = new Map<string, Parameter>();
      for (const level of [
        array(item.parameters),
        array(operation.parameters),
      ]) {
        const keys = new Set<string>();
        for (const raw of level) {
          const parameter = resolvePointer(document, raw);
          const name = text(parameter.name),
            location = text(parameter.in);
          const key = `${location}:${name}`;
          if (keys.has(key))
            throw new Error(`${source}/${method}: duplicate parameter ${key}`);
          keys.add(key);
          if (
            location === 'path' &&
            (parameter.required !== true ||
              (kind === 'endpoint' && !path.includes(`{${name}}`)))
          )
            throw new Error(
              `${source}/${method}: path parameter ${name} must be required and match the path template`,
            );
          const media = record(parameter.content);
          const mediaValues = Object.values(media);
          const schema = parameter.schema ?? record(mediaValues[0]).schema;
          byKey.set(key, {
            name,
            in: location as Parameter['in'],
            required: parameter.required === true,
            description: text(parameter.description),
            schema:
              typeof schema === 'boolean'
                ? { 'x-doctopus-boolean-schema': schema }
                : record(schema),
            ...(parameter.content === undefined
              ? {}
              : { content: content(document, parameter.content) }),
            ...(typeof parameter.style === 'string'
              ? { style: parameter.style }
              : {}),
            ...(typeof parameter.explode === 'boolean'
              ? { explode: parameter.explode }
              : {}),
            ...(parameter.allowReserved === true
              ? { allowReserved: true }
              : {}),
            ...(parameter.deprecated === true ? { deprecated: true } : {}),
            ...(parameter.example === undefined
              ? {}
              : { example: parameter.example }),
            ...(parameter.examples === undefined
              ? {}
              : {
                  examples: namedExamples(document, parameter.examples),
                }),
          });
        }
      }
      if (kind === 'endpoint')
        for (const match of path.matchAll(/\{([^}]+)\}/g))
          if (!byKey.has(`path:${match[1]}`))
            throw new Error(
              `${source}/${method}: missing path parameter ${match[1]}`,
            );
      const security = array(operation.security ?? document.security).map(
        (value) => record(value) as Record<string, string[]>,
      );
      for (const requirement of security)
        for (const name of Object.keys(requirement))
          if (!Object.hasOwn(securitySchemes, name))
            throw new Error(
              `${source}/${method}: unknown security scheme ${name}`,
            );
      const body = resolvePointer(document, operation.requestBody);
      const normalized: Operation = {
        id,
        slug,
        path,
        method,
        kind,
        ...(parent ? { callback: parent } : {}),
        summary: text(operation.summary, declaredId || id),
        description: text(operation.description),
        tags: array(operation.tags).filter(
          (tag): tag is string => typeof tag === 'string',
        ),
        deprecated: operation.deprecated === true,
        ...(lifecycle ? { lifecycle } : {}),
        parameters: [...byKey.values()],
        ...(operation.requestBody
          ? {
              requestBody: {
                required: body.required === true,
                description: text(body.description),
                content: content(document, body.content),
              },
            }
          : {}),
        responses: Object.entries(record(operation.responses)).map(
          ([status, value]) => {
            const response = resolvePointer(document, value);
            return {
              status,
              description: text(response.description),
              content: content(document, response.content),
              headers: Object.fromEntries(
                Object.entries(record(response.headers)).map(
                  ([name, rawHeader]) => [
                    name,
                    normalizedHeader(document, rawHeader),
                  ],
                ),
              ),
            };
          },
        ),
        security,
        servers: servers(operation.servers, servers(item.servers, rootServers)),
        source: `${input.path}${source}/${method}`,
        ...(operation.externalDocs
          ? {
              externalDocs: record(operation.externalDocs) as {
                url: string;
                description?: string;
              },
            }
          : {}),
      };
      if (kind === 'webhook' && !normalized.tags.length)
        normalized.tags = ['Webhooks'];
      if (kind === 'callback' && !normalized.tags.length)
        normalized.tags = ['Callbacks'];
      if (!operation.description)
        diagnostics.push({
          code: 'operation-description',
          severity: 'warning',
          message: `${kind} ${method.toUpperCase()} ${path} has no description`,
          source: normalized.source,
        });
      if (!normalized.responses.length)
        diagnostics.push({
          code: 'operation-responses',
          severity: 'warning',
          message: `${method.toUpperCase()} ${path} has no documented responses`,
          source: normalized.source,
        });
      operations.push(normalized);
      for (const [name, rawCallback] of Object.entries(
        record(operation.callbacks),
      )) {
        const callback = resolvePointer(document, rawCallback);
        for (const [expression, value] of Object.entries(callback)) {
          if (expression.startsWith('x-')) continue;
          pathItem(
            expression,
            value,
            `${source}/${method}/callbacks/${pointerEscape(name)}/${pointerEscape(expression)}`,
            'callback',
            { operationId: id, name, expression },
            depth + 1,
          );
        }
      }
    }
  }
  for (const [path, value] of Object.entries(record(document.paths))) {
    if (path.startsWith('x-')) continue;
    if (!path.startsWith('/'))
      throw new Error(`${input.path}: path must start with /: ${path}`);
    const template = path.replace(/\{[^}]+\}/g, '{}');
    if (pathTemplates.has(template))
      throw new Error(`${input.path}: ambiguous path template ${path}`);
    pathTemplates.add(template);
    pathItem(path, value, `#/paths/${pointerEscape(path)}`, 'endpoint');
  }
  for (const [name, value] of Object.entries(record(document.webhooks)))
    pathItem(name, value, `#/webhooks/${pointerEscape(name)}`, 'webhook');
  const schemas = schemaRegistry(document, operations);
  if (text(document.openapi).startsWith('3.1')) {
    const dialects = new Set([
      'https://json-schema.org/draft/2020-12/schema',
      'https://spec.openapis.org/oas/3.1/dialect/base',
    ]);
    if (
      document.jsonSchemaDialect &&
      !dialects.has(text(document.jsonSchemaDialect))
    )
      throw new Error(
        `${input.path}: unsupported JSON Schema dialect ${text(document.jsonSchemaDialect)}; use draft 2020-12 or the OpenAPI 3.1 base dialect`,
      );
    const roots: [string, unknown][] = Object.entries(schemas);
    function headerSchemas(source: string, input: unknown, depth: number) {
      const header = record(input);
      if (header.schema !== undefined)
        roots.push([source + '/schema', header.schema]);
      mediaSchemas(source + '/content', header.content, depth + 1);
    }
    function mediaSchemas(source: string, input: unknown, depth = 0) {
      if (input === undefined) return;
      if (depth > 8)
        throw new Error('Media and Header Object nesting exceeds eight levels');
      for (const [type, raw] of Object.entries(record(input))) {
        const media = record(raw),
          location = source + '/' + pointerEscape(type);
        if (media.schema !== undefined)
          roots.push([location + '/schema', media.schema]);
        for (const [field, rawEncoding] of Object.entries(
          record(media.encoding),
        ))
          for (const [name, header] of Object.entries(
            record(record(rawEncoding).headers),
          ))
            headerSchemas(
              location +
                '/encoding/' +
                pointerEscape(field) +
                '/headers/' +
                pointerEscape(name),
              header,
              depth,
            );
      }
    }
    for (const operation of operations) {
      for (const parameter of operation.parameters) {
        roots.push([
          `${operation.source}/parameters/${parameter.name}`,
          parameter.schema,
        ]);
        mediaSchemas(
          `${operation.source}/parameters/${pointerEscape(parameter.name)}/content`,
          parameter.content,
        );
      }
      mediaSchemas(
        `${operation.source}/requestBody/content`,
        operation.requestBody?.content,
      );
      for (const response of operation.responses) {
        const source = `${operation.source}/responses/${response.status}`;
        mediaSchemas(source + '/content', response.content);
        for (const [name, header] of Object.entries(response.headers))
          headerSchemas(source + '/headers/' + pointerEscape(name), header, 0);
      }
    }
    validateSchemaBoundaries(roots, dialects, input.path);
    for (const [source, value] of roots) {
      const schema = record(value);
      if (schema.$schema && !dialects.has(text(schema.$schema)))
        throw new Error(
          `${source}: unsupported JSON Schema dialect ${text(schema.$schema)}`,
        );
      const checked = { ...schema };
      delete checked.$schema;
      validateSchema(checked, source);
    }
  }
  return {
    openapiVersion: text(document.openapi),
    id: input.id,
    version: input.version ?? text(info.version),
    title: text(info.title),
    description: text(info.description),
    source: input.path,
    operations,
    schemas,
    securitySchemes,
    diagnostics,
    servers: rootServers,
  };
}
