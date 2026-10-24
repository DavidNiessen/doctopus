import type { AdditionalParameter } from '@davidniessen/doctopus-explorer';

export interface ParameterDraft extends AdditionalParameter {
  id: number;
}
export interface ParameterDrafts {
  rows: ParameterDraft[];
  nextId: number;
}
const blank = (
  id: number,
  location: AdditionalParameter['in'],
): ParameterDraft => ({
  id,
  in: location,
  name: '',
  value: '',
  enabled: true,
});
export function createParameterDrafts(): ParameterDrafts {
  return { rows: [blank(0, 'query'), blank(1, 'header')], nextId: 2 };
}
export function editParameterDraft(
  state: ParameterDrafts,
  id: number,
  patch: Partial<Pick<ParameterDraft, 'name' | 'value' | 'enabled'>>,
): ParameterDrafts {
  const rows = state.rows.map((row) =>
    row.id === id ? { ...row, ...patch } : row,
  );
  let nextId = state.nextId;
  for (const location of ['query', 'header'] as const) {
    if (!rows.some((row) => row.in === location && !row.name && !row.value))
      rows.push(blank(nextId++, location));
  }
  return { rows, nextId };
}
