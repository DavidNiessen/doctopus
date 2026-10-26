import {
  parseJsonValue,
  serializeJsonValue,
  resolveSchema,
  isJsonMediaType,
} from '@davidniessen/doctopus-contracts';
import type {
  JsonValueNode,
  Schema,
  Operation,
} from '@davidniessen/doctopus-contracts';
import {
  isFormMediaType,
  isMultipartMediaType,
} from '@davidniessen/doctopus-explorer';
import type { MultipartFiles } from '@davidniessen/doctopus-explorer';
const record = (value: unknown): Schema =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : {};
const blank = (value: JsonValueNode | undefined) =>
  !value || (value.kind === 'string' && !value.value.trim());
/** UI presence policy; serialization and API business validation remain separate. */
export function requestFields(
  operation: Operation,
  parameters: Readonly<Record<string, string>>,
  body: string,
  contentType: string,
  format: 'json' | 'serialized',
  schemas: Record<string, Schema>,
  legacy = false,
  files: MultipartFiles = {},
) {
  const errors: string[] = [];
  for (const parameter of operation.parameters) {
    if (
      parameter.in === 'header' &&
      /^(accept|content-type|authorization)$/i.test(parameter.name)
    )
      continue;
    if (
      parameter.required &&
      !parameters[`${parameter.in}:${parameter.name}`]?.trim()
    )
      errors.push(`${parameter.name} is required.`);
  }
  const media = operation.requestBody?.content[contentType];
  if (!media) return { body: '', errors };
  const uploaded = Object.entries(files)
    .filter(([, items]) => items.length)
    .map(([name]) => name);
  if (!body.trim()) {
    if (operation.requestBody?.required && !uploaded.length)
      errors.push('Request body is required.');
    return { body: '', errors };
  }
  let visits = 0;
  const shape = (schema: Schema, depth = 0): Schema => {
    if (depth > 16)
      throw new Error('Request schema exceeds the field-check depth limit.');
    const actual = resolveSchema(schema, schemas, {
      ignoreReferenceSiblings: legacy,
    });
    let properties = { ...record(actual.properties) };
    const required = new Set(
      Array.isArray(actual.required) ? actual.required : [],
    );
    for (const branch of Array.isArray(actual.allOf) ? actual.allOf : []) {
      const child = shape(record(branch), depth + 1);
      properties = { ...properties, ...record(child.properties) };
      for (const key of Array.isArray(child.required) ? child.required : [])
        required.add(key);
    }
    return { ...actual, properties, required: [...required] };
  };
  const walk = (
    value: JsonValueNode,
    schema: Schema,
    path: string,
    depth: number,
    issues: string[],
  ): JsonValueNode => {
    if (++visits > 10000 || depth > 32)
      throw new Error('Request fields exceed the validation limit.');
    const actual = shape(schema);
    const variants = actual.oneOf ?? actual.anyOf;
    if (
      Array.isArray(variants) &&
      variants.length > 0 &&
      variants.length <= 32
    ) {
      const base = { ...actual };
      delete base.oneOf;
      delete base.anyOf;
      const branches = variants.map((branch) => shape(record(branch)));
      const declaredProperties = Object.fromEntries(
        branches.flatMap((branch) => Object.entries(record(branch.properties))),
      );
      const candidates = branches.map((child) => {
        const local: string[] = [];
        const node = walk(
          value,
          {
            ...base,
            ...child,
            properties: {
              ...declaredProperties,
              ...record(base.properties),
              ...record(child.properties),
            },
            required: [
              ...new Set([
                ...((base.required as unknown[]) ?? []),
                ...((child.required as unknown[]) ?? []),
              ]),
            ],
          },
          path,
          depth + 1,
          local,
        );
        const discriminatorMismatches =
          value.kind === 'object'
            ? Object.entries(record(child.properties)).filter(
                ([name, property]) => {
                  const definition = record(property);
                  const entry = value.entries.find(
                    ([key]) => key === name,
                  )?.[1];
                  return (
                    entry &&
                    Object.hasOwn(definition, 'const') &&
                    serializeJsonValue(entry, true) !==
                      JSON.stringify(definition.const)
                  );
                },
              ).length
            : 0;
        return { node, local, discriminatorMismatches };
      });
      candidates.sort(
        (a, b) =>
          a.discriminatorMismatches - b.discriminatorMismatches ||
          a.local.length - b.local.length,
      );
      issues.push(...candidates[0]!.local);
      return candidates[0]!.node;
    }
    if (value.kind === 'object') {
      const properties = record(actual.properties),
        required = Array.isArray(actual.required) ? actual.required : [];
      for (const name of required) {
        if (
          typeof name !== 'string' ||
          shape(record(properties[name])).readOnly === true ||
          (depth === 0 && uploaded.includes(name))
        )
          continue;
        const entry = value.entries.find(([key]) => key === name)?.[1];
        if (blank(entry)) issues.push(`${path}.${name} is required.`);
      }
      const entries: typeof value.entries = [];
      for (const [name, node] of value.entries) {
        const declared = Object.hasOwn(properties, name),
          field = record(properties[name]);
        if (
          !declared &&
          (Object.keys(properties).length ||
            actual.additionalProperties === false) &&
          actual.additionalProperties !== true &&
          !(
            actual.additionalProperties &&
            typeof actual.additionalProperties === 'object'
          )
        )
          issues.push(`${path}.${name} is not defined in the specification.`);
        if (
          declared &&
          (properties[name] === false ||
            field['x-doctopus-boolean-schema'] === false)
        )
          issues.push(`${path}.${name} is not allowed by the specification.`);
        if (!required.includes(name) && blank(node)) continue;
        entries.push([
          name,
          walk(
            node,
            declared ? field : record(actual.additionalProperties),
            `${path}.${name}`,
            depth + 1,
            issues,
          ),
        ]);
      }
      return { kind: 'object', entries };
    }
    if (value.kind === 'array')
      return {
        kind: 'array',
        items: value.items.map((node, index) =>
          walk(
            node,
            record(
              Array.isArray(actual.prefixItems)
                ? (actual.prefixItems[index] ?? actual.items)
                : actual.items,
            ),
            `${path}[${index}]`,
            depth + 1,
            issues,
          ),
        ),
      };
    return value;
  };
  try {
    if (
      isJsonMediaType(contentType) ||
      ((isFormMediaType(contentType) || isMultipartMediaType(contentType)) &&
        format === 'json')
    ) {
      const parsed = parseJsonValue(body);
      if (
        !operation.requestBody?.required &&
        parsed.kind === 'object' &&
        !parsed.entries.length &&
        !uploaded.length
      )
        return { body: '', errors };
      const value = walk(parseJsonValue(body), media.schema, 'Body', 0, errors);
      if (
        !operation.requestBody?.required &&
        value.kind === 'object' &&
        !value.entries.length &&
        !uploaded.length
      )
        return { body: '', errors };
      return {
        body:
          serializeJsonValue(value, true) === serializeJsonValue(parsed, true)
            ? body
            : serializeJsonValue(value, true),
        errors: [...new Set(errors)].slice(0, 20),
      };
    }
    if (isFormMediaType(contentType) && format === 'serialized') {
      const actual = shape(media.schema),
        properties = record(actual.properties);
      const kept = body.split('&').filter((part) => {
        const entry = [...new URLSearchParams(part)][0];
        return entry && !!entry[1].trim();
      });
      const values = new URLSearchParams(kept.join('&'));
      for (const [name] of values)
        if (
          Object.keys(properties).length &&
          !Object.hasOwn(properties, name.split('[')[0]!)
        )
          errors.push(`Body.${name} is not defined in the specification.`);
      for (const name of Array.isArray(actual.required) ? actual.required : [])
        if (typeof name === 'string' && !values.has(name))
          errors.push(`Body.${name} is required.`);
      return { body: kept.join('&'), errors };
    }
  } catch (cause) {
    errors.push(
      cause instanceof Error &&
        cause.message.startsWith('Duplicate JSON properties')
        ? 'Duplicate JSON properties are not allowed in requests.'
        : 'Enter a valid request body that matches the specification.',
    );
  }
  return { body, errors: [...new Set(errors)].slice(0, 20) };
}
