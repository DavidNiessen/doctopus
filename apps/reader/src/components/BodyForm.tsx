import { useEffect, useId, useRef, useState } from 'react';
import {
  parseJsonValue,
  serializeJsonValue,
  type Schema,
  type JsonValueNode,
} from '@davidniessen/doctopus-contracts';
import { isSensitiveAdditionalParameter } from '@davidniessen/doctopus-explorer';
import {
  bodyFormFields,
  bodyFormValue,
  type BodyFormField,
} from '../body-form-fields.js';
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
function initialRows(
  value: ObjectBodyValue,
  fields: { name: string; schema: Schema }[],
) {
  const rows = bodyFormFields(value);
  for (const { name, schema } of fields) {
    if (rows.length >= 100) break;
    if (rows.some((row) => row.name === name) || schema.readOnly === true)
      continue;
    const declared = Array.isArray(schema.type)
      ? schema.type.find((type) => type !== 'null')
      : schema.type;
    const type = (
      declared === 'integer' ? 'number' : (declared ?? 'string')
    ) as JsonValueNode['kind'];
    let node: JsonValueNode | undefined;
    try {
      const key = ['const', 'default', 'example'].find(
        (key) => schema[key] !== undefined,
      );
      const seed = key
        ? schema[key]
        : Array.isArray(schema.enum)
          ? schema.enum[0]
          : undefined;
      if (seed !== undefined) node = parseJsonValue(JSON.stringify(seed));
    } catch {
      /* The JSON editor remains available for unsupported defaults. */
    }
    rows.push({
      id: rows.length,
      name,
      type: node?.kind ?? (Object.hasOwn(defaults, type) ? type : 'string'),
      value: node
        ? node.kind === 'string'
          ? node.value
          : serializeJsonValue(node)
        : (defaults[type] ?? ''),
      enabled: false,
    });
  }
  return rows;
}

export function BodyForm({
  value,
  fields,
  required,
  onChange,
  onError,
}: {
  value: ObjectBodyValue;
  fields: { name: string; schema: Schema }[];
  required: unknown[];
  onChange: (body: string) => void;
  onError: (error: string) => void;
}) {
  const [initial] = useState(() => initialRows(value, fields));
  const nextId = useRef(initial.length);
  const blank = (): BodyFormField => ({
    id: nextId.current++,
    name: '',
    value: '',
    type: 'string',
    enabled: true,
  });
  const [rows, setRows] = useState(() => [...initial, blank()]);
  const [declaredRows] = useState(
    () =>
      new Map(
        initial.flatMap((row) => {
          const field = fields.find((field) => field.name === row.name);
          return field ? [[row.id, field.schema] as const] : [];
        }),
      ),
  );
  const [readOnlyRows] = useState(
    () =>
      new Set(
        initial
          .filter((row) =>
            fields.some(
              (field) =>
                field.name === row.name && field.schema.readOnly === true,
            ),
          )
          .map((row) => row.id),
      ),
  );
  const [expanded, setExpanded] = useState(false);
  const [activeBlank, setActiveBlank] = useState<number>();
  const presence = useRef(new Map<number, boolean>());
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => () => report.current(''), []);
  function update(next: BodyFormField[]) {
    if (next.length < 101 && !next.some((row) => !row.name && !row.value))
      next.push(blank());
    setRows(next);
    try {
      const body = bodyFormValue(next);
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
  function edit(rowId: number, patch: Partial<BodyFormField>) {
    update(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }
  function focusBlank() {
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLInputElement>('.body-form-key[data-blank="true"]')
        ?.focus(),
    );
  }
  const optional = rows.filter(
    (row) =>
      declaredRows.has(row.id) &&
      !required.includes(row.name) &&
      !readOnlyRows.has(row.id),
  );
  return (
    <div className="body-form" ref={root}>
      {rows.map((row, index) => {
        const field = declaredRows.get(row.id);
        const readOnly = readOnlyRows.has(row.id);
        const requiredField = !!field && required.includes(row.name);
        const secret =
          field?.writeOnly === true ||
          field?.format === 'password' ||
          isSensitiveAdditionalParameter(row.name);
        const optionalField = optional.some((field) => field.id === row.id);
        const hidden =
          (!row.name && !row.value && activeBlank !== row.id) ||
          (optionalField && !expanded);
        const valueId = `${id}-${row.id}`;
        const changeValue = (value: string) =>
          edit(row.id, {
            value,
            enabled: presence.current.get(row.id) ?? true,
          });
        return (
          <div
            className={`request-form-field${field ? '' : ' request-custom-field'}`}
            key={row.id}
            hidden={hidden}
            role="group"
            aria-label={`Body field ${index + 1}`}
          >
            <div className="request-field-meta">
              <div className="request-field-heading">
                {field ? (
                  <label htmlFor={valueId}>
                    <code>{row.name}</code>
                  </label>
                ) : (
                  <input
                    className="body-form-key"
                    data-blank={!row.name && !row.value}
                    aria-label={`Body field key ${index + 1}`}
                    placeholder="Field name"
                    value={row.name}
                    spellCheck={false}
                    onChange={(event) =>
                      edit(row.id, { name: event.target.value })
                    }
                  />
                )}
                {field ? (
                  <span className="request-type-badge">
                    {String(field.type ?? row.type)}
                    {field.format ? `<${String(field.format)}>` : ''}
                  </span>
                ) : (
                  <select
                    className="request-type-select"
                    aria-label={`Body field type ${index + 1}`}
                    value={row.type}
                    onChange={(event) => {
                      const type = event.target.value as BodyFormField['type'];
                      edit(row.id, { type, value: defaults[type] });
                    }}
                  >
                    {Object.keys(defaults).map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                )}
                {required.includes(row.name) && (
                  <span className="request-required-badge">required</span>
                )}
                {readOnly && (
                  <span className="request-type-badge">read-only</span>
                )}
              </div>
              {typeof field?.description === 'string' && (
                <p className="request-field-description">{field.description}</p>
              )}
            </div>
            <div className="request-field-control">
              {(row.type === 'object' || row.type === 'array') && !secret ? (
                <textarea
                  id={valueId}
                  aria-required={requiredField}
                  aria-label={
                    field ? `Body ${row.name}` : `Body field value ${index + 1}`
                  }
                  value={row.value}
                  rows={2}
                  spellCheck={false}
                  readOnly={readOnly}
                  onChange={(event) => changeValue(event.target.value)}
                />
              ) : (
                <input
                  id={valueId}
                  aria-required={requiredField}
                  aria-label={
                    field ? `Body ${row.name}` : `Body field value ${index + 1}`
                  }
                  placeholder={`Enter ${row.name || 'value'}`}
                  value={row.value}
                  type={secret ? 'password' : 'text'}
                  autoComplete="off"
                  readOnly={readOnly || row.type === 'null'}
                  spellCheck={false}
                  onChange={(event) => changeValue(event.target.value)}
                />
              )}
              {!requiredField && !readOnly && (
                <div className="request-field-actions">
                  <label className="parameter-presence">
                    <input
                      type="checkbox"
                      aria-label={`Include body field ${index + 1}`}
                      checked={row.enabled}
                      disabled={readOnly || !row.name}
                      onChange={(event) => {
                        presence.current.set(row.id, event.target.checked);
                        edit(row.id, { enabled: event.target.checked });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="parameter-remove"
                    aria-label={`Remove body field ${index + 1}`}
                    disabled={readOnly || (!row.name && !row.value)}
                    onClick={() => {
                      update(rows.filter((item) => item.id !== row.id));
                      setActiveBlank(undefined);
                      requestAnimationFrame(() =>
                        root.current
                          ?.querySelector<HTMLButtonElement>(
                            '.request-form-actions button:last-child',
                          )
                          ?.focus(),
                      );
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="request-form-actions">
        {optional.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <Icon name="plus" size={14} />
            {expanded ? 'Collapse' : 'Expand'} {optional.length} optional{' '}
            {optional.length === 1 ? 'field' : 'fields'}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const blank = rows.find((row) => !row.name && !row.value);
            setActiveBlank(blank?.id);
            focusBlank();
          }}
        >
          <Icon name="plus" size={14} />
          Add body field
        </button>
      </div>
      {error && (
        <p className="request-form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
