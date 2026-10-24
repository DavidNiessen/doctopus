import { isDeepStrictEqual as equal } from 'node:util';
import {
  resolveSchema,
  parseOperationLifecycle,
} from '@davidniessen/doctopus-contracts';
import type {
  ApiDocument,
  Operation,
  Schema,
  Media,
  SecurityScheme,
} from '@davidniessen/doctopus-contracts';
import { record } from './source.js';

export interface ContractChange {
  severity: 'breaking' | 'review' | 'info';
  code: string;
  operation: string;
  location: string;
  message: string;
  referenceUrl?: string;
}
type Direction = 'request' | 'response';
const annotations = new Set([
  'title',
  'description',
  'example',
  'examples',
  'default',
  'deprecated',
  'externalDocs',
  'xml',
  '$comment',
]);
const understood = new Set([
  'type',
  'nullable',
  'enum',
  'const',
  'required',
  'properties',
  'items',
  'additionalProperties',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'uniqueItems',
  'x-doctopus-boolean-schema',
]);
const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const objectSchema = (value: unknown): Schema =>
  typeof value === 'boolean'
    ? { 'x-doctopus-boolean-schema': value }
    : record(value);
const identity = (op: Operation) =>
  JSON.stringify([
    op.kind ?? 'endpoint',
    op.method,
    op.path,
    op.callback?.operationId,
    op.callback?.name,
    op.callback?.expression,
  ]);
const types = (schema: Schema, legacy: boolean): Set<string> => {
  const declared = schema.type;
  const result = new Set<string>(
    typeof declared === 'string'
      ? [declared]
      : Array.isArray(declared)
        ? (declared as string[])
        : ['null', 'boolean', 'object', 'array', 'number', 'string'],
  );
  if (result.has('number')) result.add('integer');
  if (legacy && schema.nullable === true && typeof declared === 'string')
    result.add('null');
  return result;
};
const values = (schema: Schema): unknown[] | undefined =>
  Object.hasOwn(schema, 'const')
    ? [schema.const]
    : Array.isArray(schema.enum)
      ? schema.enum
      : undefined;
const includes = (list: unknown[], value: unknown) =>
  list.some((item) => equal(item, value));
function keywordKind(keyword: string): 'schema' | 'map' | 'array' | 'value' {
  if (
    [
      'properties',
      'patternProperties',
      '$defs',
      'definitions',
      'dependentSchemas',
    ].includes(keyword)
  )
    return 'map';
  if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(keyword))
    return 'array';
  if (
    [
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
      'contentSchema',
      'additionalItems',
    ].includes(keyword)
  )
    return 'schema';
  return 'value';
}
function securityDefinition(value: SecurityScheme | undefined): unknown {
  if (!value) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'description')
      .map(([key, child]) => [
        key,
        key === 'flows'
          ? Object.fromEntries(
              Object.entries(record(child)).map(([name, flow]) => [
                name,
                Object.fromEntries(
                  Object.entries(record(flow)).map(([field, setting]) => [
                    field,
                    field === 'scopes'
                      ? Object.keys(record(setting)).sort()
                      : setting,
                  ]),
                ),
              ]),
            )
          : child,
      ]),
  );
}

/** A conservative structural classifier, not a general JSON Schema implication solver. */
export function diffApi(
  before: ApiDocument,
  after: ApiDocument,
): ContractChange[] {
  const changes: ContractChange[] = [];
  const legacy = [before, after].map(
    (api) =>
      api.openapiVersion === undefined || api.openapiVersion.startsWith('3.0'),
  );
  let visited = 0;
  const resolved = [
    new WeakMap<Schema, Schema>(),
    new WeakMap<Schema, Schema>(),
  ];
  const resolve = (schema: Schema, side: 0 | 1) => {
    const cache = resolved[side]!;
    let value = cache.get(schema);
    if (!value) {
      value = resolveSchema(
        schema,
        side === 0 ? before.schemas : after.schemas,
        { ignoreReferenceSiblings: legacy[side]! },
      );
      if (!legacy[side] && Object.hasOwn(value, 'nullable'))
        value = Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== 'nullable'),
        );
      cache.set(schema, value);
    }
    return value;
  };
  const previous = new Map(before.operations.map((op) => [identity(op), op]));
  const following = new Map(after.operations.map((op) => [identity(op), op]));
  const dependencyChanged = (
    left: unknown,
    right: unknown,
    kind: 'schema' | 'map' | 'array' | 'value',
    depth = 0,
    active = new WeakMap<object, WeakSet<object>>(),
  ): boolean => {
    if (++visited > 100_000)
      throw new Error(
        'Contract diff exceeds its 100,000-node comparison budget',
      );
    if (depth > 64) return true;
    if (
      !left ||
      !right ||
      typeof left !== 'object' ||
      typeof right !== 'object'
    )
      return !equal(left, right);
    const a =
      kind === 'schema' && !Array.isArray(left)
        ? resolve(record(left), 0)
        : left;
    const b =
      kind === 'schema' && !Array.isArray(right)
        ? resolve(record(right), 1)
        : right;
    const pairs = active.get(a) ?? new WeakSet<object>();
    if (pairs.has(b)) return false;
    active.set(a, pairs);
    pairs.add(b);
    try {
      if (Array.isArray(a) || Array.isArray(b))
        return (
          !Array.isArray(a) ||
          !Array.isArray(b) ||
          a.length !== b.length ||
          a.some((value, index) =>
            dependencyChanged(
              value,
              b[index],
              kind === 'array' ? 'schema' : 'value',
              depth + 1,
              active,
            ),
          )
        );
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [...keys].some(
        (key) =>
          !(kind === 'schema' && annotations.has(key)) &&
          dependencyChanged(
            record(a)[key],
            record(b)[key],
            kind === 'map'
              ? 'schema'
              : kind === 'schema'
                ? keywordKind(key)
                : 'value',
            depth + 1,
            active,
          ),
      );
    } finally {
      pairs.delete(b);
    }
  };
  for (const [key, old] of previous) {
    const next = following.get(key);
    const operation = `${old.kind ?? 'endpoint'} ${old.method.toUpperCase()} ${old.path}`;
    const add = (
      severity: ContractChange['severity'],
      code: string,
      location: string,
      message: string,
    ) => {
      if (changes.length >= 10_000)
        throw new Error(
          'Contract diff exceeds 10,000 changes; compare smaller API documents',
        );
      const url = next?.externalDocs?.url;
      changes.push({
        severity,
        code,
        operation,
        location,
        message,
        ...(url && /^https?:\/\//.test(url) ? { referenceUrl: url } : {}),
      });
    };
    if (!next) {
      add('breaking', 'operation-removed', '/', 'Operation was removed.');
      continue;
    }
    const active = new WeakMap<Schema, WeakSet<Schema>>();
    const schema = (
      rawOld: Schema,
      rawNext: Schema,
      direction: Direction,
      path: string,
      depth = 0,
    ): void => {
      if (++visited > 100_000)
        throw new Error(
          'Contract diff exceeds its 100,000-node comparison budget',
        );
      if (depth > 64) {
        add(
          'review',
          'schema-depth',
          path,
          'Schema depth exceeds 64; review this branch manually.',
        );
        return;
      }
      const a = resolve(rawOld, 0),
        b = resolve(rawNext, 1);
      let pairs = active.get(a);
      if (pairs?.has(b)) return;
      if (!pairs) {
        pairs = new WeakSet();
        active.set(a, pairs);
      }
      pairs.add(b);
      try {
        const incompatible = (
          requestBreaks: boolean,
          responseBreaks: boolean,
          code: string,
          location: string,
          message: string,
        ) =>
          add(
            (direction === 'request' ? requestBreaks : responseBreaks)
              ? 'breaking'
              : 'info',
            code,
            location,
            message,
          );
        const oldFalse = a['x-doctopus-boolean-schema'] === false;
        const nextFalse = b['x-doctopus-boolean-schema'] === false;
        if (oldFalse !== nextFalse)
          incompatible(
            nextFalse,
            oldFalse,
            'schema-boolean',
            path,
            'Schema changed whether any values are allowed.',
          );
        if (oldFalse || nextFalse) return;
        const ta = types(a, legacy[0]!),
          tb = types(b, legacy[1]!);
        if (
          [...ta].some((type) => !tb.has(type)) ||
          [...tb].some((type) => !ta.has(type))
        )
          incompatible(
            [...ta].some((type) => !tb.has(type)),
            [...tb].some((type) => !ta.has(type)),
            'schema-type',
            `${path}/type`,
            'Allowed value types changed.',
          );
        const va = values(a),
          vb = values(b);
        if (
          (va === undefined) !== (vb === undefined) ||
          (va &&
            vb &&
            (va.some((value) => !includes(vb, value)) ||
              vb.some((value) => !includes(va, value))))
        )
          incompatible(
            vb !== undefined &&
              (va === undefined || va.some((value) => !includes(vb, value))),
            va !== undefined &&
              (vb === undefined || vb.some((value) => !includes(va, value))),
            'schema-enum',
            `${path}/enum`,
            'Allowed literal values changed.',
          );
        for (const keyword of [
          'minLength',
          'maxLength',
          'minItems',
          'maxItems',
          'minProperties',
          'maxProperties',
        ]) {
          const lower = keyword.startsWith('min');
          const fallback = lower ? 0 : Infinity;
          const x =
            typeof a[keyword] === 'number' ? (a[keyword] as number) : fallback;
          const y =
            typeof b[keyword] === 'number' ? (b[keyword] as number) : fallback;
          if (x !== y)
            incompatible(
              lower ? y > x : y < x,
              lower ? y < x : y > x,
              'schema-bound',
              `${path}/${keyword}`,
              `${keyword} changed from ${x} to ${y}.`,
            );
        }
        for (const bound of ['minimum', 'maximum'] as const) {
          const exclusive =
            bound === 'minimum' ? 'exclusiveMinimum' : 'exclusiveMaximum';
          const value = (s: Schema) => {
            const limits = [
              {
                value:
                  typeof s[bound] === 'number'
                    ? (s[bound] as number)
                    : bound === 'minimum'
                      ? -Infinity
                      : Infinity,
                strict: s[exclusive] === true,
              },
              ...(typeof s[exclusive] === 'number'
                ? [{ value: s[exclusive] as number, strict: true }]
                : []),
            ];
            return limits.sort(
              (x, y) =>
                (bound === 'minimum' ? y.value - x.value : x.value - y.value) ||
                Number(y.strict) - Number(x.strict),
            )[0]!;
          };
          const x = value(a),
            y = value(b);
          if (!equal(x, y)) {
            const tighter =
              x.value === y.value
                ? y.strict && !x.strict
                : bound === 'minimum'
                  ? y.value > x.value
                  : y.value < x.value;
            incompatible(
              tighter,
              !tighter,
              'schema-bound',
              `${path}/${bound}`,
              `${bound} or its exclusive boundary changed.`,
            );
          }
        }
        if ((a.uniqueItems === true) !== (b.uniqueItems === true))
          incompatible(
            b.uniqueItems === true,
            a.uniqueItems === true,
            'schema-unique',
            `${path}/uniqueItems`,
            'Array uniqueness requirement changed.',
          );
        const hidden = direction === 'request' ? 'readOnly' : 'writeOnly';
        const required = (s: Schema, side: 0 | 1) =>
          new Set(
            (Array.isArray(s.required) ? (s.required as string[]) : []).filter(
              (name) =>
                resolve(objectSchema(record(s.properties)[name]), side)[
                  hidden
                ] !== true,
            ),
          );
        const ra = required(a, 0);
        const rb = required(b, 1);
        for (const name of new Set([...ra, ...rb])) {
          if (ra.has(name) !== rb.has(name))
            incompatible(
              rb.has(name),
              ra.has(name),
              'schema-required',
              `${path}/required/${escape(name)}`,
              `${name} is now ${rb.has(name) ? 'required' : 'optional'}.`,
            );
        }
        const pa = record(a.properties),
          pb = record(b.properties);
        for (const name of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
          const location = `${path}/properties/${escape(name)}`;
          if (
            (resolve(objectSchema(pa[name]), 0)[hidden] === true &&
              !Object.hasOwn(pb, name)) ||
            (resolve(objectSchema(pb[name]), 1)[hidden] === true &&
              !Object.hasOwn(pa, name))
          )
            continue;
          if (!Object.hasOwn(pb, name)) {
            add(
              direction === 'response' || b.additionalProperties === false
                ? 'breaking'
                : 'info',
              'schema-property-removed',
              location,
              `Property ${name} was removed.`,
            );
          } else if (!Object.hasOwn(pa, name)) {
            add(
              direction === 'response' && a.additionalProperties === false
                ? 'breaking'
                : direction === 'request' && a.additionalProperties !== false
                  ? 'review'
                  : 'info',
              'schema-property-added',
              location,
              `Property ${name} was added${direction === 'request' && a.additionalProperties !== false ? '; previously unconstrained extra values may be rejected' : ''}.`,
            );
          } else {
            const left = objectSchema(pa[name]),
              right = objectSchema(pb[name]);
            // Directional projections are safe only while visibility stays unchanged.
            if (!(left[hidden] === true && right[hidden] === true))
              schema(left, right, direction, location, depth + 1);
          }
        }
        if (a.items !== undefined || b.items !== undefined)
          schema(
            objectSchema(a.items),
            objectSchema(b.items),
            direction,
            `${path}/items`,
            depth + 1,
          );
        const extraA = a.additionalProperties ?? true,
          extraB = b.additionalProperties ?? true;
        if (typeof extraA === 'boolean' && typeof extraB === 'boolean') {
          if (extraA !== extraB)
            incompatible(
              !extraB,
              !extraA,
              'schema-additional-properties',
              `${path}/additionalProperties`,
              'Additional property policy changed.',
            );
        } else if (typeof extraA === 'object' && typeof extraB === 'object') {
          schema(
            objectSchema(extraA),
            objectSchema(extraB),
            direction,
            `${path}/additionalProperties`,
            depth + 1,
          );
        } else if (!equal(extraA, extraB))
          add(
            'review',
            'schema-additional-properties',
            `${path}/additionalProperties`,
            'Additional property schema/policy changed; review value compatibility.',
          );
        for (const keyword of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (annotations.has(keyword) || understood.has(keyword)) continue;
          if (dependencyChanged(a[keyword], b[keyword], keywordKind(keyword)))
            add(
              'review',
              'schema-review',
              `${path}/${escape(keyword)}`,
              `${keyword} changed; compatibility requires review.`,
            );
        }
      } finally {
        pairs.delete(b);
      }
    };
    const incoming = old.kind === 'webhook' || old.kind === 'callback';
    const request: Direction = incoming ? 'response' : 'request';
    const response: Direction = incoming ? 'request' : 'response';
    const media = (
      a: Record<string, Media>,
      b: Record<string, Media>,
      direction: Direction,
      path: string,
    ) => {
      for (const type of Object.keys(a)) {
        if (!Object.hasOwn(b, type))
          add(
            'breaking',
            'media-removed',
            `${path}/${escape(type)}`,
            `Media type ${type} was removed.`,
          );
        else {
          schema(
            a[type]!.schema,
            b[type]!.schema,
            direction,
            `${path}/${escape(type)}/schema`,
          );
          if (!equal(a[type]!.encoding, b[type]!.encoding))
            add(
              'review',
              'media-encoding',
              `${path}/${escape(type)}/encoding`,
              'Media encoding changed; review multipart/form serialization.',
            );
        }
      }
      for (const type of Object.keys(b))
        if (!Object.hasOwn(a, type))
          add(
            direction === 'response' ? 'review' : 'info',
            'media-added',
            `${path}/${escape(type)}`,
            `Media type ${type} was added.`,
          );
    };
    if (old.id !== next.id)
      add(
        'breaking',
        'operation-id',
        '/operationId',
        'Operation identity changed; generated SDK methods and documentation URLs may change.',
      );
    if (old.deprecated !== next.deprecated)
      add(
        'info',
        'operation-deprecated',
        '/deprecated',
        next.deprecated
          ? 'Operation is now deprecated; publish a migration guide and removal date.'
          : 'Operation is no longer deprecated.',
      );
    const previousLifecycle = old.lifecycle
      ? parseOperationLifecycle(old.lifecycle)
      : {};
    const nextLifecycle = next.lifecycle
      ? parseOperationLifecycle(next.lifecycle)
      : {};
    if (!equal(previousLifecycle, nextLifecycle)) {
      const tighter =
        (nextLifecycle.sunsetOn &&
          (!previousLifecycle.sunsetOn ||
            nextLifecycle.sunsetOn < previousLifecycle.sunsetOn)) ||
        (nextLifecycle.deprecatedOn &&
          previousLifecycle.deprecatedOn &&
          nextLifecycle.deprecatedOn < previousLifecycle.deprecatedOn);
      add(
        tighter ? 'review' : 'info',
        'operation-lifecycle',
        '/x-doctopus-lifecycle',
        tighter
          ? 'A retirement deadline was introduced or brought forward; review the migration timeline.'
          : 'Lifecycle dates, replacements or migration guidance changed.',
      );
    }
    for (const server of old.servers)
      if (!next.servers.includes(server))
        add(
          'breaking',
          'server-removed',
          '/servers',
          `Server ${server} was removed.`,
        );
    const parameterKey = (p: Operation['parameters'][number]) =>
      `${p.in}:${p.in === 'header' ? p.name.toLowerCase() : p.name}`;
    const oldParameters = new Map(
      old.parameters.map((p) => [parameterKey(p), p]),
    );
    const newParameters = new Map(
      next.parameters.map((p) => [parameterKey(p), p]),
    );
    for (const [name, parameter] of oldParameters) {
      const current = newParameters.get(name),
        path = `/parameters/${escape(name)}`;
      if (!current) {
        add(
          'breaking',
          'parameter-removed',
          path,
          `Parameter ${name} was removed.`,
        );
        continue;
      }
      if (!parameter.required && current.required)
        add(
          'breaking',
          'parameter-required',
          path,
          `Parameter ${name} is now required.`,
        );
      const serialization = (p: typeof parameter) => {
        const style =
          p.style ??
          (p.in === 'query' || p.in === 'cookie' ? 'form' : 'simple');
        return {
          style,
          explode: p.explode ?? style === 'form',
          allowReserved: p.allowReserved === true,
        };
      };
      if (!equal(serialization(parameter), serialization(current)))
        add(
          'breaking',
          'parameter-serialization',
          path,
          `Parameter ${name} serialization changed.`,
        );
      if (parameter.content || current.content)
        media(
          parameter.content ?? {},
          current.content ?? {},
          request,
          `${path}/content`,
        );
      else schema(parameter.schema, current.schema, request, `${path}/schema`);
    }
    for (const [name, parameter] of newParameters)
      if (!oldParameters.has(name))
        add(
          parameter.required ? 'breaking' : 'info',
          'parameter-added',
          `/parameters/${escape(name)}`,
          `${parameter.required ? 'Required' : 'Optional'} parameter ${name} was added.`,
        );
    if (old.requestBody && !next.requestBody)
      add(
        'breaking',
        'request-body-removed',
        '/requestBody',
        'Request body was removed.',
      );
    if (!old.requestBody?.required && next.requestBody?.required)
      add(
        'breaking',
        'request-body-required',
        '/requestBody',
        'Request body is now required.',
      );
    if (!old.requestBody && next.requestBody && !next.requestBody.required)
      add(
        'info',
        'request-body-added',
        '/requestBody',
        'An optional request body was added.',
      );
    if (old.requestBody && next.requestBody)
      media(
        old.requestBody.content,
        next.requestBody.content,
        request,
        '/requestBody/content',
      );
    const oldResponses = new Map(old.responses.map((r) => [r.status, r]));
    const newResponses = new Map(next.responses.map((r) => [r.status, r]));
    for (const [status, previous] of oldResponses) {
      const current = newResponses.get(status),
        path = `/responses/${escape(status)}`;
      if (!current) {
        add(
          'breaking',
          'response-removed',
          path,
          `Response ${status} was removed.`,
        );
        continue;
      }
      media(previous.content, current.content, response, `${path}/content`);
      const headers = (input: Record<string, unknown>) =>
        new Map(
          Object.entries(input).map(([name, value]) => [
            name.toLowerCase(),
            record(value),
          ]),
        );
      const left = headers(previous.headers),
        right = headers(current.headers);
      for (const [name, header] of left) {
        const nextHeader = right.get(name);
        if (!nextHeader)
          add(
            'breaking',
            'response-header-removed',
            `${path}/headers/${escape(name)}`,
            `Response header ${name} was removed.`,
          );
        else {
          if (header.required === true && nextHeader.required !== true)
            add(
              'breaking',
              'response-header-required',
              `${path}/headers/${escape(name)}`,
              `Response header ${name} is no longer guaranteed.`,
            );
          if (header.content || nextHeader.content)
            add(
              'review',
              'response-header-content',
              `${path}/headers/${escape(name)}/content`,
              'Content-based response header serialization requires review.',
            );
          else
            schema(
              objectSchema(header.schema),
              objectSchema(nextHeader.schema),
              response,
              `${path}/headers/${escape(name)}/schema`,
            );
          if (
            !equal(header.style ?? 'simple', nextHeader.style ?? 'simple') ||
            !equal(header.explode ?? false, nextHeader.explode ?? false)
          )
            add(
              'breaking',
              'response-header-serialization',
              `${path}/headers/${escape(name)}`,
              'Response header serialization changed.',
            );
        }
      }
    }
    for (const status of newResponses.keys())
      if (!oldResponses.has(status))
        add(
          'review',
          'response-added',
          `/responses/${escape(status)}`,
          `Response ${status} was added; review client status handling.`,
        );
    const requirements = (op: Operation) =>
      op.security.length ? op.security : [{}];
    const tightened = requirements(old).some(
      (oldRequirement) =>
        !requirements(next).some((newRequirement) =>
          Object.entries(newRequirement).every(
            ([name, scopes]) =>
              Object.hasOwn(oldRequirement, name) &&
              scopes.every((scope) => oldRequirement[name]!.includes(scope)) &&
              equal(
                securityDefinition(before.securitySchemes[name]),
                securityDefinition(after.securitySchemes[name]),
              ),
          ),
        ),
    );
    if (tightened)
      add(
        incoming ? 'review' : 'breaking',
        'security-tightened',
        '/security',
        'A previously accepted authentication alternative or scope set is no longer sufficient.',
      );
    else if (!equal(old.security, next.security))
      add(
        'info',
        'security-changed',
        '/security',
        'Authentication alternatives changed without rejecting an existing credential set.',
      );
  }
  for (const [key, op] of following)
    if (!previous.has(key)) {
      if (changes.length >= 10_000)
        throw new Error(
          'Contract diff exceeds 10,000 changes; compare smaller API documents',
        );
      changes.push({
        severity: 'info',
        code: 'operation-added',
        operation: `${op.kind ?? 'endpoint'} ${op.method.toUpperCase()} ${op.path}`,
        location: '/',
        message: 'Operation was added.',
      });
    }
  return changes.sort(
    (a, b) =>
      a.operation.localeCompare(b.operation, 'en') ||
      a.location.localeCompare(b.location, 'en') ||
      a.code.localeCompare(b.code, 'en'),
  );
}
