import type { JsonValueNode, Schema } from '@davidniessen/doctopus-contracts';
import { queryParts } from './parameters.js';

export const hasBodyStyle = (encoding: Schema): boolean =>
  ['style', 'explode', 'allowReserved'].some((field) =>
    Object.hasOwn(encoding, field),
  );

function scalar(value: JsonValueNode): string {
  if (value.kind === 'string' || value.kind === 'boolean')
    return String(value.value);
  if (value.kind === 'number') return value.text;
  if (value.kind === 'null') return '';
  throw new Error(
    'Styled form values must be flat. Use JSON content encoding for nested data.',
  );
}

/** Encoding Object style semantics share query serialization without rounding numbers. */
export function styledBodyParts(
  name: string,
  value: JsonValueNode,
  schema: Schema,
  encoding: Schema,
) {
  if (
    (encoding.style !== undefined && typeof encoding.style !== 'string') ||
    (encoding.explode !== undefined && typeof encoding.explode !== 'boolean') ||
    (encoding.allowReserved !== undefined &&
      typeof encoding.allowReserved !== 'boolean')
  )
    throw new Error(`Invalid form encoding for ${name}`);
  const styled =
    value.kind === 'array'
      ? value.items.map(scalar)
      : value.kind === 'object'
        ? Object.fromEntries(
            value.entries.map(([key, child]) => [key, scalar(child)]),
          )
        : scalar(value);
  return queryParts(styled, {
    name,
    in: 'query',
    required: true,
    description: '',
    schema,
    ...(typeof encoding.style === 'string' ? { style: encoding.style } : {}),
    ...(typeof encoding.explode === 'boolean'
      ? { explode: encoding.explode }
      : {}),
    ...(typeof encoding.allowReserved === 'boolean'
      ? { allowReserved: encoding.allowReserved }
      : {}),
  });
}
