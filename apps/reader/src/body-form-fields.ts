import {
  parseJsonValue,
  serializeJsonValue,
  type JsonValueNode,
} from '@davidniessen/doctopus-contracts';

export type BodyFormField = {
  id: number;
  name: string;
  value: string;
  type: JsonValueNode['kind'];
  enabled: boolean;
};

export function bodyFormFields(
  value: Extract<JsonValueNode, { kind: 'object' }>,
): BodyFormField[] {
  return value.entries.map(([name, node], id) => ({
    id,
    name,
    value: node.kind === 'string' ? node.value : serializeJsonValue(node),
    type: node.kind,
    enabled: true,
  }));
}

/** Rebuild the lossless syntax tree; never round numeric tokens via JS numbers. */
export function bodyFormValue(rows: readonly BodyFormField[]): string {
  const entries: [string, JsonValueNode][] = [];
  const names = new Set<string>();
  for (const row of rows) {
    if (!row.enabled || (!row.name && !row.value)) continue;
    if (!row.name) throw new Error('Enter a key for every body field.');
    if (names.has(row.name))
      throw new Error(`Duplicate body field: ${row.name}. Use unique keys.`);
    names.add(row.name);
    let node: JsonValueNode;
    try {
      node =
        row.type === 'string'
          ? { kind: 'string', value: row.value }
          : parseJsonValue(row.value);
    } catch {
      throw new Error(`Enter a valid ${row.type} value for ${row.name}.`);
    }
    if (node.kind !== row.type)
      throw new Error(`Enter a valid ${row.type} value for ${row.name}.`);
    entries.push([row.name, node]);
    if (entries.length > 100)
      throw new Error('Use JSON for bodies with more than 100 form fields.');
  }
  return serializeJsonValue({ kind: 'object', entries }, true);
}
