import { encodeValue, setRequestHeader } from './parameters.js';
import type { QueryPart } from './parameters.js';

/** Literal, user-authored fields supplement the operation's typed parameters. */
export interface AdditionalParameter {
  in: 'query' | 'header';
  name: string;
  value: string;
  enabled?: boolean;
}

export function appendAdditionalParameters(
  rows: readonly AdditionalParameter[],
  query: QueryPart[],
  headers: Record<string, string>,
  bodyContentType?: string,
  managedParameters: ReadonlySet<string> = new Set(),
): void {
  const names = new Set<string>();
  for (const row of rows) {
    if (row.enabled !== undefined && typeof row.enabled !== 'boolean')
      throw new Error('Additional parameter inclusion must be a boolean.');
    if (row.enabled === false || row.name === '') continue;
    if (typeof row.name !== 'string' || typeof row.value !== 'string')
      throw new Error('Additional parameter names and values must be text.');
    const key = row.in === 'header' ? row.name.toLowerCase() : row.name;
    if (managedParameters.has(`${row.in}:${key}`))
      throw new Error(`Use the authentication controls to set ${row.name}.`);
    if (row.in === 'query') {
      query.push({ name: row.name, value: encodeValue(row.value) });
    } else if (row.in === 'header') {
      const name = row.name.toLowerCase();
      if (names.has(name))
        throw new Error(`Duplicate additional header: ${row.name}`);
      names.add(name);
      if (name === 'content-type' && bodyContentType)
        throw new Error(
          'Use the request body Content type control to set Content-Type.',
        );
      setRequestHeader(headers, row.name, row.value);
    } else
      throw new Error('Additional parameters must be query or header fields.');
  }
}

export const isSensitiveAdditionalParameter = (name: string): boolean =>
  /(?:authorization|api[-_]?key|token|password|secret|credential|session|cookie)/i.test(
    name,
  );

/** Extra credentials stay out of copied examples even without an OpenAPI scheme. */
export function redactAdditionalParameters(
  rows: readonly AdditionalParameter[],
): AdditionalParameter[] {
  return rows.map((row) => {
    if (!isSensitiveAdditionalParameter(row.name)) return row;
    const scheme =
      row.in === 'header' && /^authorization$/i.test(row.name)
        ? (/^(Bearer|Basic)\s+/i.exec(row.value)?.[0] ?? '')
        : '';
    return { ...row, value: row.value ? scheme + 'YOUR_CREDENTIAL' : '' };
  });
}
