import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import {
  isJsonMediaType,
  resolveSchema,
} from '@davidniessen/doctopus-contracts';
import type {
  ApiDocument,
  Diagnostic,
  Schema,
  Media,
} from '@davidniessen/doctopus-contracts';
import type { ValidateFunction } from 'ajv';
import { record } from './source.js';
import { unsupportedSchemaScopeKeywords } from './schema-boundaries.js';

function validateExamples(api: ApiDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (
    code: string,
    source: string,
    message: string,
    severity: 'error' | 'warning' = 'warning',
  ) => {
    if (diagnostics.length >= 10_000) throw new Error('Diagnostic limit');
    diagnostics.push({ code, severity, source, message });
  };
  const legacy = api.openapiVersion?.startsWith('3.0') === true;
  const ignored = new Set([
    'example',
    'examples',
    'description',
    'title',
    'default',
    'deprecated',
    'readOnly',
    'writeOnly',
    'externalDocs',
    'xml',
    'discriminator',
    'nullable',
  ]);
  const mapKeywords = new Set([
    'properties',
    'patternProperties',
    '$defs',
    'definitions',
    'dependentSchemas',
  ]);
  const arrayKeywords = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
  const schemaKeywords = new Set([
    'items',
    'additionalProperties',
    'unevaluatedProperties',
    'unevaluatedItems',
    'contains',
    'not',
    'if',
    'then',
    'else',
    'propertyNames',
    'additionalItems',
  ]);
  const refs = new Map(
    Object.keys(api.schemas).map((key, index) => [key, `d${index}`]),
  );
  const convertRef = (ref: string) => {
    const key = refs.has(ref)
      ? ref
      : ref.startsWith('#/components/schemas/')
        ? decodeURIComponent(ref.slice('#/components/schemas/'.length))
            .replace(/~1/g, '/')
            .replace(/~0/g, '~')
        : ref;
    const name = refs.get(key);
    if (!name) throw new Error('Unresolved local reference');
    return `urn:doctopus:examples#/$defs/${name}`;
  };
  let nodes = 0,
    examples = 0;
  for (const direction of ['request', 'response', 'component'] as const) {
    const ajv = new Ajv2020({
      strict: false,
      allErrors: false,
      ownProperties: true,
      logger: false,
      messages: false,
      validateFormats: true,
    });
    (addFormats as unknown as FormatsPlugin)(ajv);
    const convert = (
      raw: unknown,
      source: string,
      depth = 0,
    ): Schema | boolean => {
      if (++nodes > 500_000 || depth > 64)
        throw new Error('Schema conversion budget');
      if (typeof raw === 'boolean') return raw;
      const schema = record(raw);
      if (typeof schema['x-doctopus-boolean-schema'] === 'boolean')
        return schema['x-doctopus-boolean-schema'] as boolean;
      if (legacy && typeof schema.$ref === 'string')
        return { $ref: convertRef(schema.$ref) };
      const result: Schema = Object.create(null) as Schema;
      for (const [key, value] of Object.entries(schema)) {
        if (ignored.has(key) || key === '$schema') continue;
        if (unsupportedSchemaScopeKeywords.has(key)) {
          add(
            'example-schema-unsupported',
            source,
            `Example schema uses ${key}; review scope/dynamic-reference semantics.`,
          );
          continue;
        }
        if (key === '$ref' && typeof value === 'string')
          result[key] = convertRef(value);
        else if (mapKeywords.has(key))
          result[key] = Object.fromEntries(
            Object.entries(record(value)).map(([name, child]) => [
              name,
              convert(child, `${source}/${key}/${name}`, depth + 1),
            ]),
          );
        else if (arrayKeywords.has(key) && Array.isArray(value))
          result[key] = value.map((child, i) =>
            convert(child, `${source}/${key}/${i}`, depth + 1),
          );
        else if (schemaKeywords.has(key))
          result[key] = convert(value, `${source}/${key}`, depth + 1);
        else {
          result[key] = value;
          if (!ajv.getKeyword(key) && !key.startsWith('x-'))
            add(
              'example-schema-unsupported',
              source,
              `Example validation does not enforce schema keyword ${key}.`,
            );
          if (
            key === 'format' &&
            typeof value === 'string' &&
            !Object.hasOwn(ajv.formats, value)
          )
            add(
              'example-schema-unsupported',
              source,
              `Example validation does not enforce format ${value}.`,
            );
        }
      }
      if (legacy) {
        if (schema.nullable === true && typeof result.type === 'string')
          result.type = [result.type, 'null'];
        for (const [exclusive, bound] of [
          ['exclusiveMinimum', 'minimum'],
          ['exclusiveMaximum', 'maximum'],
        ] as const) {
          if (typeof schema[exclusive] === 'boolean') {
            delete result[exclusive];
            if (
              schema[exclusive] === true &&
              typeof schema[bound] === 'number'
            ) {
              result[exclusive] = schema[bound];
              delete result[bound];
            }
          }
        }
      }
      if (direction !== 'component' && Array.isArray(result.required)) {
        const hidden = direction === 'request' ? 'readOnly' : 'writeOnly';
        result.required = result.required.filter(
          (name) =>
            resolveSchema(
              record(record(schema.properties)[String(name)]),
              api.schemas,
              { ignoreReferenceSiblings: legacy },
            )[hidden] !== true,
        );
      }
      return result;
    };
    const definitions = Object.fromEntries(
      Object.entries(api.schemas).map(([key, schema]) => [
        refs.get(key)!,
        convert(schema, `${api.source}#/components/schemas/${key}`),
      ]),
    );
    ajv.addSchema({ $id: 'urn:doctopus:examples', $defs: definitions });
    const validators = new WeakMap<Schema, ValidateFunction | false>();
    const validate = (schema: Schema, example: unknown, source: string) => {
      if (++examples > 10_000) throw new Error('Example count budget');
      let validator = validators.get(schema);
      if (validator === undefined) {
        try {
          validator = ajv.compile(convert(schema, source));
        } catch {
          validator = false;
        }
        validators.set(schema, validator);
      }
      if (!validator) {
        add(
          'example-schema-unsupported',
          source,
          'Example schema could not be compiled; review references, patterns and supported keywords.',
        );
        return;
      }
      if (!validator(example))
        add(
          'invalid-example',
          source,
          `Authored example does not satisfy its schema (${validator.errors?.[0]?.keyword ?? 'validation'}). Example values are omitted.`,
          'error',
        );
    };
    const authored = (
      schema: Schema,
      value: { example?: unknown; examples?: unknown },
      source: string,
      mediaType?: string,
    ) => {
      const check = (example: unknown, location: string) => {
        const actual = resolveSchema(schema, api.schemas, {
          ignoreReferenceSiblings: legacy,
        });
        const plainString =
          mediaType?.split(';')[0]?.trim().toLowerCase() === 'text/plain' &&
          (actual.type === 'string' ||
            (Array.isArray(actual.type) && actual.type.includes('string')));
        if (
          mediaType &&
          !isJsonMediaType(mediaType) &&
          !plainString &&
          actual['x-doctopus-boolean-schema'] !== false
        ) {
          if (typeof example !== 'string') validate(schema, example, location);
          else if (++examples > 10_000) throw new Error('Example count budget');
          add(
            'example-serialization-unsupported',
            location,
            typeof example === 'string'
              ? 'Serialized non-JSON example was not decoded or checked against its logical schema; review it with a media-specific validator.'
              : 'Native example was checked against its logical schema; non-JSON wire serialization was not verified.',
          );
          return;
        }
        validate(schema, example, location);
      };
      if (Object.hasOwn(value, 'example'))
        check(value.example, `${source}/example`);
      if (Array.isArray(value.examples))
        value.examples.forEach((example, i) =>
          check(example, `${source}/examples/${i}`),
        );
      else
        for (const [name, raw] of Object.entries(record(value.examples))) {
          const item = record(raw);
          if (Object.hasOwn(item, 'value'))
            check(item.value, `${source}/examples/${name}`);
          else if (item.externalValue)
            add(
              'external-example',
              `${source}/examples/${name}`,
              'External example was not fetched; vendor a value locally to validate it offline.',
            );
        }
    };
    const seen = new WeakSet<Schema>();
    const walk = (schema: Schema, source: string, depth = 0): void => {
      if (seen.has(schema)) return;
      if (depth > 64 || ++nodes > 500_000)
        throw new Error('Schema traversal budget');
      seen.add(schema);
      authored(schema, schema, source);
      for (const [key, value] of Object.entries(schema)) {
        if (mapKeywords.has(key))
          for (const [name, child] of Object.entries(record(value)))
            walk(record(child), `${source}/${key}/${name}`, depth + 1);
        else if (arrayKeywords.has(key) && Array.isArray(value))
          value.forEach((child, i) =>
            walk(record(child), `${source}/${key}/${i}`, depth + 1),
          );
        else if (schemaKeywords.has(key) && value && typeof value === 'object')
          walk(record(value), `${source}/${key}`, depth + 1);
      }
    };
    if (direction === 'component') {
      for (const [key, schema] of Object.entries(api.schemas))
        walk(schema, `${api.source}#/components/schemas/${key}`);
      continue;
    }
    const media = (content: Record<string, Media>, source: string) => {
      for (const [type, item] of Object.entries(content)) {
        authored(item.schema, item, `${source}/${type}`, type);
        walk(item.schema, `${source}/${type}/schema`);
      }
    };
    for (const operation of api.operations) {
      const incoming =
        operation.kind === 'callback' || operation.kind === 'webhook';
      if (direction === (incoming ? 'response' : 'request')) {
        for (const parameter of operation.parameters) {
          const source = `${operation.source}/parameters/${parameter.in}:${parameter.name}`;
          authored(parameter.schema, parameter, source);
          walk(parameter.schema, `${source}/schema`);
          if (parameter.content) media(parameter.content, `${source}/content`);
        }
        if (operation.requestBody)
          media(
            operation.requestBody.content,
            `${operation.source}/requestBody/content`,
          );
      } else
        for (const response of operation.responses) {
          media(
            response.content,
            `${operation.source}/responses/${response.status}/content`,
          );
          for (const [name, header] of Object.entries(response.headers)) {
            const item = record(header),
              schema = record(item.schema);
            authored(
              schema,
              item,
              `${operation.source}/responses/${response.status}/headers/${name}`,
            );
            walk(
              schema,
              `${operation.source}/responses/${response.status}/headers/${name}/schema`,
            );
            if (item.content)
              media(
                record(item.content) as Record<string, Media>,
                `${operation.source}/responses/${response.status}/headers/${name}/content`,
              );
          }
        }
    }
  }
  return [
    ...new Map(
      diagnostics.map((diagnostic) => [JSON.stringify(diagnostic), diagnostic]),
    ).values(),
  ];
}
async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > 128 * 1024 * 1024) throw new Error('Input budget');
    chunks.push(chunk as Buffer);
  }
  const diagnostics = validateExamples(
    JSON.parse(Buffer.concat(chunks).toString('utf8')) as ApiDocument,
  );
  process.stdout.write(JSON.stringify(diagnostics));
}
void main().catch(() => {
  process.exitCode = 1;
});
