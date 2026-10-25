import {
  parseJsonValue,
  resolveSchema,
  objectFieldSchema,
  schemaVariants,
} from '@davidniessen/doctopus-contracts';
import type {
  JsonValueNode,
  Schema,
  SchemaVariants,
} from '@davidniessen/doctopus-contracts';

export type ObjectBodyValue = Extract<JsonValueNode, { kind: 'object' }>;
export type ArrayBodyValue = Extract<JsonValueNode, { kind: 'array' }>;
export const MAX_ARRAY_ITEMS = 50;
type Unavailable = { available: false; error: string };
export type BodyPath = readonly (string | number)[];
export type BodyVariants = SchemaVariants & { selected?: number };
type ChildEditors = {
  nested?: BodyFieldModel;
  array?: BodyArrayModel;
  variants?: BodyVariants;
};
export type BodyArrayModel =
  | {
      available: true;
      value: ArrayBodyValue;
      schema: Schema;
      items: (ChildEditors & { value: JsonValueNode; schema: Schema })[];
    }
  | Unavailable;
export type BodyFieldModel =
  | {
      available: true;
      value: ObjectBodyValue;
      fields: (ChildEditors & { name: string; schema: Schema })[];
      formFields: { name: string; schema: Schema }[];
      required: unknown[];
    }
  | Unavailable;
const object = (value: unknown): Schema =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : {};
const complex = (schema: Schema) =>
  Boolean(
    schema.$ref ||
    schema.allOf ||
    schema.oneOf ||
    schema.anyOf ||
    schema.if ||
    schema.then ||
    schema.else ||
    schema.not,
  );
/** A shared render budget bounds nested controls independently of the JSON parser. */
export function bodyFieldModel(
  body: string,
  schema: Schema,
  schemas: Record<string, Schema>,
  legacy: boolean,
  options: {
    variants?: boolean;
    selections?: ReadonlyMap<string, number>;
    form?: boolean;
  } = {},
): BodyFieldModel | BodyArrayModel {
  const budget = { remaining: 100 };
  const resolved = (schema: Schema, sensitive = false): Schema => {
    let actual = resolveSchema(schema, schemas, {
      ignoreReferenceSiblings: legacy,
    });
    try {
      actual = objectFieldSchema(actual, schemas, legacy);
    } catch {
      // Unsupported field shapes keep their original local JSON fallback.
    }
    return {
      ...actual,
      ...(!legacy ? { nullable: false } : {}),
      ...(sensitive ? { writeOnly: true } : {}),
    };
  };
  const select = (schema: Schema, path: BodyPath, sensitive: boolean) => {
    const base = resolved(schema, sensitive);
    const variants =
      options.variants && base.readOnly !== true
        ? schemaVariants(schema, schemas, legacy)
        : undefined;
    const index = options.selections?.get(JSON.stringify(path));
    const selected =
      variants && index !== undefined && Number.isInteger(index)
        ? variants.choices[index]
        : undefined;
    return {
      schema: selected ? resolved(selected.schema, sensitive) : base,
      ...(variants
        ? {
            variants: {
              ...variants,
              ...(selected ? { selected: index! } : {}),
            },
          }
        : {}),
    };
  };
  function children(
    value: JsonValueNode | undefined,
    schema: Schema,
    depth: number,
    sensitive: boolean,
    path: BodyPath,
  ): ChildEditors {
    if (
      Object.hasOwn(schema, 'const') ||
      Array.isArray(schema.enum) ||
      schema.readOnly === true
    )
      return {};
    if (value?.kind === 'object')
      return { nested: build(value, schema, depth, sensitive, path) };
    if (value?.kind === 'array')
      return { array: buildArray(value, schema, depth, sensitive, path) };
    return {};
  }
  function buildArray(
    value: ArrayBodyValue,
    schema: Schema,
    depth: number,
    sensitive: boolean,
    path: BodyPath,
  ): BodyArrayModel {
    try {
      if (depth >= 8)
        throw new Error(
          'Use JSON for arrays beyond eight field-editor levels.',
        );
      const actual = resolved(schema, sensitive);
      const types = Array.isArray(actual.type)
        ? actual.type.filter((type) => type !== 'null')
        : actual.type
          ? [actual.type]
          : [];
      if (types.length && (types.length !== 1 || types[0] !== 'array'))
        throw new Error('Use JSON for ambiguous array type unions.');
      if (
        complex(actual) ||
        Object.hasOwn(actual, 'const') ||
        Array.isArray(actual.enum) ||
        actual.prefixItems ||
        Array.isArray(actual.items) ||
        actual.items === false ||
        actual.contains !== undefined ||
        actual.unevaluatedItems !== undefined ||
        actual.additionalItems !== undefined
      )
        throw new Error(
          'Use JSON for tuple, composed or conditional array schemas.',
        );
      if (value.items.length > MAX_ARRAY_ITEMS)
        throw new Error('Use JSON for arrays with more than 50 items.');
      if (value.items.length > budget.remaining)
        throw new Error('Use JSON when nested editing exceeds 100 controls.');
      budget.remaining -= value.items.length;
      const itemSchema = resolved(
        object(actual.items),
        actual.writeOnly === true,
      );
      return {
        available: true,
        value,
        schema: itemSchema,
        items: value.items.map((value, index) => {
          const childPath = [...path, index];
          const selected = select(
            object(actual.items),
            childPath,
            actual.writeOnly === true,
          );
          return {
            value,
            ...selected,
            ...children(
              value,
              selected.schema,
              depth + 1,
              selected.schema.writeOnly === true,
              childPath,
            ),
          };
        }),
      };
    } catch (error) {
      return {
        available: false,
        error:
          error instanceof Error ? error.message : 'Use JSON for this array.',
      };
    }
  }

  function build(
    value: JsonValueNode,
    schema: Schema,
    depth: number,
    sensitive = false,
    path: BodyPath = [],
  ): BodyFieldModel {
    try {
      if (value.kind !== 'object')
        throw new Error('Use JSON to edit scalar request bodies.');
      if (depth >= 8)
        throw new Error(
          'Use JSON for objects beyond eight field-editor levels.',
        );
      const actual = objectFieldSchema(schema, schemas, legacy);
      if (complex(actual))
        throw new Error(
          'Use JSON for composed or conditional request schemas.',
        );
      const types = Array.isArray(actual.type)
        ? actual.type.filter((type) => type !== 'null')
        : actual.type
          ? [actual.type]
          : [];
      if (types.length && (types.length !== 1 || types[0] !== 'object'))
        throw new Error('Field editing requires an object request schema.');
      sensitive = sensitive || actual.writeOnly === true;
      const properties = Object.entries(object(actual.properties));
      if (properties.length > 100)
        throw new Error(
          'Use JSON for requests with more than 100 declared fields.',
        );
      const formFields = properties
        .filter(([, property]) => property !== false)
        .map(([name, property]) => {
          return {
            name,
            ...select(object(property), [...path, name], sensitive),
          };
        });
      const fields = formFields.filter(
        (field) => field.schema.readOnly !== true || field.variants,
      );
      if (!fields.length && !options.form)
        throw new Error('No ediform fields are defined. Use JSON.');
      if (fields.length > budget.remaining)
        throw new Error('Use JSON when nested editing exceeds 100 controls.');
      budget.remaining -= fields.length;
      return {
        available: true,
        value,
        formFields,
        required: Array.isArray(actual.required) ? actual.required : [],
        fields: fields.map((field) => {
          const child = value.entries.find(([key]) => key === field.name)?.[1];
          return {
            ...field,
            ...children(
              child,
              field.schema,
              depth + 1,
              sensitive || field.schema.writeOnly === true,
              [...path, field.name],
            ),
          };
        }),
      };
    } catch (error) {
      return {
        available: false,
        error:
          error instanceof Error
            ? error.message
            : 'Use the JSON editor for this body.',
      };
    }
  }
  try {
    const value = parseJsonValue(body);
    return value.kind === 'array'
      ? buildArray(value, schema, 0, false, [])
      : build(value, schema, 0);
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Use JSON for this body.',
    };
  }
}
/** Error and selection keys share typed paths, so literal dots and numeric keys cannot collide. */
export function bodyPathWithin(
  key: string,
  path: BodyPath,
  descendantsOnly = false,
): boolean {
  let candidate: unknown;
  try {
    candidate = JSON.parse(key);
  } catch {
    return false;
  }
  return (
    Array.isArray(candidate) &&
    candidate.length >= path.length + (descendantsOnly ? 1 : 0) &&
    path.every((part, index) => candidate[index] === part)
  );
}
/** Dot/bracket labels keep literal dots and nested paths distinct. */
export function bodyFieldLabel(path: readonly (string | number)[]): string {
  return path
    .map((part, index) =>
      typeof part === 'number'
        ? '[' + part + ']'
        : /^[a-zA-Z_$][\w$]*$/.test(part)
          ? (index ? '.' : '') + part
          : '[' + JSON.stringify(part) + ']',
    )
    .join('');
}
