import { useEffect, useId, useRef, useState } from 'react';
import { serializeJsonValue } from '@davidniessen/doctopus-contracts';
import type { Schema, JsonValueNode } from '@davidniessen/doctopus-contracts';
import { isSensitiveAdditionalParameter } from '@davidniessen/doctopus-explorer';
import { bodyFormValue, type BodyFormField } from '../body-form-fields.js';
import type { ObjectBodyValue } from '../body-fields.js';
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
  const declared = fields.filter((field) => field.schema.readOnly !== true);
  const [rows, setRows] = useState<BodyFormField[]>(() =>
    declared.map(({ name, schema }, id) => {
      const node = value.entries.find(([key]) => key === name)?.[1];
      const type = Array.isArray(schema.type)
        ? schema.type.find((type) => type !== 'null')
        : schema.type;
      const kind =
        node?.kind ??
        (type === 'integer' ? 'number' : type) ??
        (schema.properties ? 'object' : 'string');
      const text = node
        ? node.kind === 'string'
          ? node.value
          : serializeJsonValue(node)
        : '';
      return {
        id,
        name,
        type: kind as JsonValueNode['kind'],
        value: text,
        enabled: !!text.trim(),
      };
    }),
  );
  const [error, setError] = useState('');
  const id = useId(),
    report = useRef(onError);
  report.current = onError;
  useEffect(() => () => report.current(''), []);
  function edit(index: number, text: string) {
    const next = rows.map((row, position) =>
      position === index
        ? { ...row, value: text, enabled: !!text.trim() }
        : row,
    );
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
  return (
    <div className="body-form">
      {!rows.length && (
        <p className="subtle">Use JSON for this request body.</p>
      )}
      {rows.map((row, index) => {
        const field = declared[index]!.schema,
          missing = required.includes(row.name) && !row.value.trim(),
          valueId = id + '-' + index;
        const control = {
          id: valueId,
          'aria-label': `Body ${row.name}`,
          'aria-required': required.includes(row.name),
          'aria-invalid': missing || undefined,
          'aria-describedby': missing ? valueId + '-error' : undefined,
          value: row.value,
          onChange: (
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
          ) => edit(index, event.target.value),
          spellCheck: false,
        };
        return (
          <div className="request-form-field" key={row.name}>
            <label className="request-field-meta" htmlFor={valueId}>
              <span className="request-field-heading">
                <code>{row.name}</code>
                <span className="request-type-badge">
                  {String(field.type ?? row.type)}
                </span>
                {required.includes(row.name) && (
                  <span className="request-required-badge">required</span>
                )}
              </span>
              {typeof field.description === 'string' && (
                <span className="request-field-description">
                  {field.description}
                </span>
              )}
            </label>
            <div className="request-field-control">
              {row.type === 'object' || row.type === 'array' ? (
                <textarea {...control} rows={2} />
              ) : (
                <input
                  {...control}
                  placeholder={`Enter ${row.name}`}
                  type={
                    field.writeOnly === true ||
                    field.format === 'password' ||
                    isSensitiveAdditionalParameter(row.name)
                      ? 'password'
                      : 'text'
                  }
                  autoComplete="off"
                />
              )}
              {missing && (
                <p id={valueId + '-error'} className="request-field-error">
                  {row.name} is required.
                </p>
              )}
            </div>
          </div>
        );
      })}
      {error && (
        <p className="request-form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
