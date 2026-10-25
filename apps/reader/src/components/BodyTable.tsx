import { useEffect, useRef, useState } from 'react';
import type { Schema } from '@davidniessen/doctopus-contracts';
import { isSensitiveAdditionalParameter } from '@davidniessen/doctopus-explorer';
import {
  bodyTableRows,
  bodyTableValue,
  type BodyTableRow,
} from '../body-table.js';
import type { ObjectBodyValue } from '../body-fields.js';
import { Icon } from './Icon.js';

const defaults = {
  string: '',
  number: '0',
  boolean: 'false',
  null: 'null',
  object: '{}',
  array: '[]',
};

export function BodyTable({
  value,
  fields,
  onChange,
  onError,
}: {
  value: ObjectBodyValue;
  fields: { name: string; schema: Schema }[];
  onChange: (body: string) => void;
  onError: (error: string) => void;
}) {
  const nextId = useRef(value.entries.length);
  const blank = (): BodyTableRow => ({
    id: nextId.current++,
    name: '',
    value: '',
    type: 'string',
    enabled: true,
  });
  const [rows, setRows] = useState(() => [...bodyTableRows(value), blank()]);
  const [readOnlyRows] = useState(
    () =>
      new Set(
        value.entries.flatMap(([name], index) =>
          fields.some(
            (field) => field.name === name && field.schema.readOnly === true,
          )
            ? [index]
            : [],
        ),
      ),
  );
  const [error, setError] = useState('');
  const root = useRef<HTMLDetailsElement>(null);
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => () => report.current(''), []);

  function update(next: BodyTableRow[]) {
    if (next.length < 101 && !next.some((row) => !row.name && !row.value))
      next.push(blank());
    setRows(next);
    try {
      const body = bodyTableValue(next);
      setError('');
      onError('');
      onChange(body);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Enter valid body fields.';
      setError(message);
      onError(message);
    }
  }
  function edit(id: number, patch: Partial<BodyTableRow>) {
    update(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  function focusBlank() {
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLInputElement>('.body-table-key[data-blank="true"]')
        ?.focus(),
    );
  }
  return (
    <details className="request-parameter-section body-table" open ref={root}>
      <summary>Request body fields</summary>
      <div className="request-parameter-columns" aria-hidden="true">
        <span />
        <span>Key</span>
        <span>Value / type</span>
        <span />
      </div>
      {rows.map((row, index) => {
        const field = fields.find((field) => field.name === row.name)?.schema;
        const readOnly = readOnlyRows.has(row.id);
        const secret =
          field?.writeOnly === true ||
          field?.format === 'password' ||
          isSensitiveAdditionalParameter(row.name);
        return (
          <div
            className="request-parameter-row"
            key={row.id}
            role="group"
            aria-label={`Body field ${index + 1}`}
          >
            <label className="parameter-presence">
              <input
                type="checkbox"
                aria-label={`Include body field ${index + 1}`}
                checked={row.enabled}
                disabled={readOnly || !row.name}
                onChange={(event) =>
                  edit(row.id, { enabled: event.target.checked })
                }
              />
            </label>
            <input
              className="body-table-key"
              data-blank={!row.name && !row.value}
              aria-label={`Body field key ${index + 1}`}
              placeholder="Key"
              value={row.name}
              readOnly={readOnly}
              spellCheck={false}
              onChange={(event) => edit(row.id, { name: event.target.value })}
            />
            <div className="body-table-value">
              <input
                aria-label={`Body field value ${index + 1}`}
                placeholder="Value"
                value={row.value}
                type={secret ? 'password' : 'text'}
                autoComplete="off"
                readOnly={readOnly || row.type === 'null'}
                spellCheck={false}
                onChange={(event) =>
                  edit(row.id, { value: event.target.value })
                }
              />
              <select
                aria-label={`Body field type ${index + 1}`}
                value={row.type}
                disabled={readOnly}
                onChange={(event) => {
                  const type = event.target.value as BodyTableRow['type'];
                  edit(row.id, { type, value: defaults[type] });
                }}
              >
                {Object.keys(defaults).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="parameter-remove"
              aria-label={`Remove body field ${index + 1}`}
              disabled={readOnly || (!row.name && !row.value)}
              onClick={() => {
                update(rows.filter((item) => item.id !== row.id));
                focusBlank();
              }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
      <div className="parameter-row-actions">
        <button
          type="button"
          onClick={() => {
            if (root.current) root.current.open = true;
            focusBlank();
          }}
        >
          Add body field
        </button>
      </div>
      {error && (
        <p className="body-table-error" role="alert">
          {error} Fix the draft before sending, or switch editors to use the
          last valid body.
        </p>
      )}
    </details>
  );
}
