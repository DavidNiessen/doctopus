import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  parseJsonValue,
  serializeJsonValue,
  setJsonProperty,
  schemaVariants,
} from '@davidniessen/doctopus-contracts';
import type { JsonValueNode, Schema } from '@davidniessen/doctopus-contracts';
import type { ReactNode } from 'react';
import { BodyTable } from './BodyTable.js';
import {
  BodyBranchContext as BranchContext,
  BodyBranchSelector as BranchSelector,
} from './BodyBranchSelector.js';
import {
  bodyFieldModel,
  bodyFieldLabel,
  MAX_ARRAY_ITEMS,
  bodyPathWithin,
} from '../body-fields.js';
import type {
  BodyFieldModel,
  ObjectBodyValue,
  BodyArrayModel,
  ArrayBodyValue,
  BodyPath,
} from '../body-fields.js';

const typeOf = (schema: Schema) =>
  Array.isArray(schema.type)
    ? schema.type.find((value) => value !== 'null')
    : schema.type;
function seed(schema: Schema, nonNull = false): JsonValueNode {
  for (const key of ['const', 'default', 'example'])
    if (schema[key] !== undefined && !(nonNull && schema[key] === null))
      return parseJsonValue(JSON.stringify(schema[key]));
  if (Array.isArray(schema.enum)) {
    const options = schema.enum.filter((value) => !nonNull || value !== null);
    if (options.length) return parseJsonValue(JSON.stringify(options[0]));
  }
  switch (typeOf(schema)) {
    case 'string':
      return { kind: 'string', value: '' };
    case 'number':
    case 'integer':
      return { kind: 'number', text: '0' };
    case 'boolean':
      return { kind: 'boolean', value: false };
    case 'array':
      return { kind: 'array', items: [] };
    case 'object':
      return { kind: 'object', entries: [] };
    default:
      return schema.properties
        ? { kind: 'object', entries: [] }
        : { kind: 'null' };
  }
}

function FieldValue({
  name,
  schema,
  value,
  onChange,
  onError,
  nested,
  nestedReason,
  path,
}: {
  name: string;
  nested?: ReactNode;
  nestedReason?: string | undefined;
  path: BodyPath;
  schema: Schema;
  value: JsonValueNode;
  onChange: (value: JsonValueNode) => void;
  onError: (name: string, error: string) => void;
}) {
  const branchActions = useContext(BranchContext);
  const text = serializeJsonValue(value, true),
    id = useId();
  const [draft, setDraft] = useState(text),
    [error, setError] = useState('');
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => {
    setDraft(text);
    setError('');
    report.current(name, '');
  }, [text, name]);
  useEffect(() => () => report.current(name, ''), [name]);
  const [nestedMode, setNestedMode] = useState<'fields' | 'json'>('fields');
  const declared =
    Array.isArray(schema.type) &&
    schema.type.filter((type) => type !== 'null').length > 1
      ? undefined
      : typeOf(schema);
  const nullable =
    (Array.isArray(schema.type) && schema.type.includes('null')) ||
    (schema.nullable === true && typeof schema.type === 'string');
  const options =
    Array.isArray(schema.enum) && schema.enum.length <= 50
      ? schema.enum
      : undefined;
  const current = serializeJsonValue(value);
  const sensitive = schema.writeOnly === true || schema.format === 'password';
  if (Object.hasOwn(schema, 'const')) {
    const fixed = JSON.stringify(schema.const);
    return (
      <div className="body-constant">
        <p>
          Fixed value: <code>{sensitive ? '••••••' : fixed}</code>
        </p>
        {current !== fixed && (
          <>
            <p className="subtle">
              Use this constant explicitly to replace the current value.
            </p>
            <button
              type="button"
              aria-label={`Use fixed value for body ${name}`}
              onClick={() => {
                try {
                  onChange(parseJsonValue(fixed));
                  onError(name, '');
                } catch {
                  onError(name, 'Use JSON to apply this fixed value.');
                }
              }}
            >
              Use fixed value
            </button>
          </>
        )}
      </div>
    );
  }
  const commit = (input: string) => {
    setDraft(input);
    try {
      const parsed = parseJsonValue(input);
      const types = Array.isArray(schema.type)
        ? schema.type
        : declared
          ? [declared]
          : [];
      const expected = types.map((type) =>
        type === 'integer' ? 'number' : type,
      );
      if (
        expected.length &&
        !expected.includes(parsed.kind) &&
        !(nullable && parsed.kind === 'null')
      )
        throw new Error(`Enter a JSON ${expected.join(' or ')}.`);
      if (parsed.kind === 'object' || parsed.kind === 'array')
        branchActions?.reset(path);
      onChange(parsed);
      setError('');
      onError(name, '');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Enter a valid JSON value.';
      setError(message);
      onError(name, `${name}: ${message}`);
    }
  };
  return (
    <div className="body-value">
      {options ? (
        <label>
          Value
          <select
            aria-label={`Body ${name}`}
            value={current}
            onChange={(event) => {
              onChange(parseJsonValue(event.target.value));
            }}
          >
            {!options.some((option) => JSON.stringify(option) === current) && (
              <option value={current}>
                Current: {sensitive ? 'sensitive value' : current}
              </option>
            )}
            {options.map((option, index) => (
              <option key={index} value={JSON.stringify(option)}>
                {sensitive
                  ? `Sensitive value ${index + 1}`
                  : JSON.stringify(option)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          {nullable && (
            <label className="body-checkbox">
              <input
                type="checkbox"
                aria-label={`Use null for body ${name}`}
                checked={value.kind === 'null'}
                onChange={(event) => {
                  try {
                    const next: JsonValueNode = event.target.checked
                      ? { kind: 'null' }
                      : seed(
                          { ...schema, nullable: false, type: declared },
                          true,
                        );
                    branchActions?.reset(path);
                    onChange(next);
                  } catch {
                    setError(
                      'This field cannot be initialized here. Use JSON.',
                    );
                    onError(name, 'Use JSON to initialize this field.');
                  }
                }}
              />
              Use null
            </label>
          )}
          {nested && (value.kind === 'object' || value.kind === 'array') && (
            <div
              role="group"
              aria-label={`${name} ${value.kind} editor`}
              className="body-nested-modes"
            >
              <button
                type="button"
                aria-label={`Edit body ${name} fields`}
                aria-pressed={nestedMode === 'fields'}
                onClick={() => {
                  setNestedMode('fields');
                  setDraft(text);
                  setError('');
                  onError(name, '');
                }}
              >
                Fields
              </button>
              <button
                type="button"
                aria-label={`Edit body ${name} as JSON`}
                aria-pressed={nestedMode === 'json'}
                onClick={() => {
                  setNestedMode('json');
                  branchActions?.reset(path);
                  setDraft(text);
                  setError('');
                  onError(name, '');
                }}
              >
                JSON
              </button>
            </div>
          )}
          {nestedReason && <p className="subtle">{nestedReason}</p>}
          {value.kind === 'null' &&
            !nullable &&
            (declared === 'object' || declared === 'array') && (
              <button
                type="button"
                className="body-array-add"
                aria-label={`Initialize body ${name} as ${declared}`}
                onClick={() => {
                  branchActions?.reset(path);
                  onChange(
                    declared === 'object'
                      ? { kind: 'object', entries: [] }
                      : { kind: 'array', items: [] },
                  );
                  onError(name, '');
                }}
              >
                Start empty {declared}
              </button>
            )}
          {nullable && value.kind === 'null' ? (
            <code>null</code>
          ) : nested &&
            nestedMode === 'fields' &&
            (value.kind === 'object' || value.kind === 'array') ? (
            nested
          ) : declared === 'string' ||
            (!declared && value.kind === 'string') ? (
            <label>
              Value
              <input
                aria-label={`Body ${name}`}
                type={sensitive ? 'password' : 'text'}
                autoComplete="off"
                value={value.kind === 'string' ? value.value : current}
                onChange={(event) =>
                  onChange({ kind: 'string', value: event.target.value })
                }
              />
            </label>
          ) : declared === 'boolean' ||
            (!declared && value.kind === 'boolean') ? (
            <label>
              Value
              <select
                aria-label={`Body ${name}`}
                value={current}
                onChange={(event) =>
                  onChange({
                    kind: 'boolean',
                    value: event.target.value === 'true',
                  })
                }
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
          ) : (
            <label>
              {declared === 'number' || declared === 'integer'
                ? 'Value'
                : 'JSON value'}
              <textarea
                aria-label={`Body ${name}`}
                aria-invalid={!!error}
                aria-describedby={error ? id : undefined}
                inputMode={
                  declared === 'number' || declared === 'integer'
                    ? 'decimal'
                    : 'text'
                }
                rows={declared === 'number' || declared === 'integer' ? 1 : 3}
                value={draft}
                spellCheck={false}
                onChange={(event) => commit(event.target.value)}
              />
            </label>
          )}
        </>
      )}
      {error && (
        <p id={id} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ChildFields({
  nested,
  array,
  path,
  onChange,
  onError,
}: {
  nested?: BodyFieldModel | undefined;
  array?: BodyArrayModel | undefined;
  path: (string | number)[];
  onChange: (value: JsonValueNode) => void;
  onError: (key: string, error: string) => void;
}) {
  return (
    <fieldset className="body-nested-fields">
      <legend>{bodyFieldLabel(path)}</legend>
      {nested?.available ? (
        <ObjectFields
          model={nested}
          path={path}
          onChange={onChange}
          onError={onError}
        />
      ) : array?.available ? (
        <ArrayFields
          model={array}
          path={path}
          onChange={onChange}
          onError={onError}
        />
      ) : null}
    </fieldset>
  );
}

function ArrayFields({
  model,
  path,
  onChange,
  onError,
}: {
  model: Extract<BodyArrayModel, { available: true }>;
  path: (string | number)[];
  onChange: (value: ArrayBodyValue) => void;
  onError: (key: string, error: string) => void;
}) {
  const branchActions = useContext(BranchContext);
  const [revision, setRevision] = useState(0),
    [error, setError] = useState('');
  const report = useRef(onError);
  const list = useRef<HTMLDivElement>(null),
    add = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | null>(null);
  report.current = onError;
  const errorKey = JSON.stringify([...path, '$add']),
    label = bodyFieldLabel(path) || '$';
  useEffect(() => () => report.current(errorKey, ''), [errorKey]);
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    const item = list.current?.children.item(index);
    const target =
      item?.querySelector<HTMLElement>('input, textarea, select') ??
      item?.querySelector<HTMLElement>('button') ??
      add.current;
    target?.focus();
  }, [revision]);
  const update = (items: JsonValueNode[]) => onChange({ kind: 'array', items });
  const restructure = (
    items: JsonValueNode[],
    focusIndex = items.length - 1,
  ) => {
    pendingFocus.current = focusIndex;
    // Index changes must never attach an incomplete draft to a different item.
    setRevision((value) => value + 1);
    setError('');
    onError(errorKey, '');
    branchActions?.reset(path);
    update(items);
  };
  return (
    <div className="body-array-fields">
      <p className="subtle">
        Adding or removing an item discards incomplete drafts in this array.
        Valid values are retained.
      </p>
      {model.items.some((item) => item.variants) && (
        <p className="subtle">
          Adding or removing items also resets their schema choices.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div ref={list} key={revision} className="body-object-fields">
        {model.items.map(
          ({ value, schema, nested, array, variants }, index) => {
            const itemPath = [...path, index],
              name = bodyFieldLabel(itemPath),
              key = JSON.stringify(itemPath);
            return (
              <div className="body-array-item" key={key}>
                <div className="body-array-item-heading">
                  <code>{name}</code>
                  <button
                    type="button"
                    aria-label={`Remove body ${name}`}
                    onClick={() =>
                      restructure(
                        model.value.items.filter(
                          (_, position) => position !== index,
                        ),
                        Math.min(index, model.items.length - 2),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
                {variants && (
                  <BranchSelector variants={variants} path={itemPath} />
                )}
                {schema.readOnly === true ? (
                  <p className="subtle">
                    This branch is read-only. The current value is retained.
                  </p>
                ) : (
                  <FieldValue
                    key={`${key}:${variants?.selected ?? ''}`}
                    path={itemPath}
                    name={name}
                    schema={schema}
                    value={value}
                    onChange={(value) =>
                      update(
                        model.value.items.map((previous, position) =>
                          position === index ? value : previous,
                        ),
                      )
                    }
                    onError={(_name, error) => onError(key, error)}
                    nestedReason={
                      nested && !nested.available
                        ? nested.error
                        : array && !array.available
                          ? array.error
                          : undefined
                    }
                    nested={
                      nested?.available || array?.available ? (
                        <ChildFields
                          nested={nested}
                          array={array}
                          path={itemPath}
                          onChange={(value) =>
                            update(
                              model.value.items.map((previous, position) =>
                                position === index ? value : previous,
                              ),
                            )
                          }
                          onError={onError}
                        />
                      ) : undefined
                    }
                  />
                )}
              </div>
            );
          },
        )}
      </div>
      <button
        ref={add}
        className="body-array-add"
        type="button"
        aria-label={`Add item to body ${label}`}
        disabled={model.items.length >= MAX_ARRAY_ITEMS}
        onClick={() => {
          try {
            restructure([...model.value.items, seed(model.schema)]);
          } catch {
            setError('This item cannot be initialized here. Use JSON.');
            onError(errorKey, 'Use JSON to initialize this array item.');
          }
        }}
      >
        + Add item
      </button>
    </div>
  );
}

function ObjectFields({
  model,
  path = [],
  onChange,
  onError,
}: {
  model: Extract<BodyFieldModel, { available: true }>;
  path?: (string | number)[];
  onChange: (value: ObjectBodyValue) => void;
  onError: (key: string, error: string) => void;
}) {
  const branchActions = useContext(BranchContext);
  const [error, setError] = useState('');
  const activeErrors = useRef(new Set<string>()),
    report = useRef(onError);
  report.current = onError;
  const reportError = (key: string, error: string) => {
    if (error) activeErrors.current.add(key);
    else activeErrors.current.delete(key);
    onError(key, error);
  };
  useEffect(
    () => () => {
      for (const key of activeErrors.current) report.current(key, '');
    },
    [],
  );

  return (
    <div className="body-object-fields">
      {error && <p role="alert">{error}</p>}
      {model.fields.map(({ name, schema: field, nested, array, variants }) => {
        const fieldPath = [...path, name],
          label = bodyFieldLabel(fieldPath),
          key = JSON.stringify(fieldPath);
        const value = model.value.entries.find(([key]) => key === name)?.[1];
        const update = (node: JsonValueNode | undefined) =>
          onChange(setJsonProperty(model.value, name, node));
        return (
          <div className="body-field" key={key}>
            <div className="body-field-heading">
              <label className="body-checkbox">
                <input
                  type="checkbox"
                  aria-label={`Include body ${label}`}
                  checked={!!value}
                  disabled={field.readOnly === true}
                  onChange={(event) => {
                    try {
                      update(event.target.checked ? seed(field) : undefined);
                      if (!event.target.checked)
                        branchActions?.reset(fieldPath);
                      setError('');
                      reportError(key, '');
                    } catch {
                      setError(
                        'This field cannot be initialized here. Edit it in JSON.',
                      );
                      reportError(key, 'Use JSON to initialize this field.');
                    }
                  }}
                />
                <code>{name}</code>
              </label>
              <small>
                {String(typeOf(field) ?? 'JSON')}
                {model.required.includes(name) ? ' · required' : ''}
                {field.readOnly === true ? ' · read-only' : ''}
              </small>
            </div>
            {typeof field.description === 'string' && (
              <p className="subtle">{field.description}</p>
            )}
            {variants && (
              <BranchSelector variants={variants} path={fieldPath} />
            )}
            {value && field.readOnly !== true && (
              <FieldValue
                key={`${key}:${variants?.selected ?? ''}`}
                path={fieldPath}
                name={label}
                schema={field}
                value={value}
                onChange={update}
                onError={(_name, error) => reportError(key, error)}
                nestedReason={
                  nested && !nested.available
                    ? nested.error
                    : array && !array.available
                      ? array.error
                      : undefined
                }
                nested={
                  nested?.available || array?.available ? (
                    <ChildFields
                      nested={nested}
                      array={array}
                      path={fieldPath}
                      onChange={update}
                      onError={reportError}
                    />
                  ) : undefined
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BodyEditor({
  body,
  schema,
  schemas,
  legacy,
  onChange,
  onError,
  initialMode = 'json',
  allowVariants = true,
}: {
  body: string;
  schema: Schema;
  schemas: Record<string, Schema>;
  legacy: boolean;
  onChange: (body: string) => void;
  onError: (error: string) => void;
  initialMode?: 'json' | 'fields';
  allowVariants?: boolean;
}) {
  const [mode, setMode] = useState<'json' | 'fields' | 'table'>(initialMode);
  const [variant, setVariant] = useState<number | undefined>();
  const [revision, setRevision] = useState(0);
  const [selections, setSelections] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const variants = useMemo(
    () => (allowVariants ? schemaVariants(schema, schemas, legacy) : undefined),
    [schema, schemas, legacy, allowVariants],
  );
  const selectedSchema =
    variant === undefined
      ? schema
      : (variants?.choices[variant]?.schema ?? schema);

  const errors = useRef(new Map<string, string>()),
    report = useRef(onError);
  report.current = onError;
  useEffect(() => () => report.current(''), []);
  const model = useMemo(
    () =>
      bodyFieldModel(body, selectedSchema, schemas, legacy, {
        variants: allowVariants,
        selections,
        table: true,
      }),
    [body, selectedSchema, schemas, legacy, allowVariants, selections],
  );
  const available = model.available;
  const shownMode = available ? mode : 'json';
  useEffect(() => {
    if (!available) setMode('json');
  }, [available]);
  useEffect(() => {
    if (mode === 'json') {
      errors.current.clear();
      report.current('');
    }
  }, [mode]);
  const fieldError = (name: string, error: string) => {
    if (error) errors.current.set(name, error);
    else errors.current.delete(name);
    onError(errors.current.values().next().value ?? '');
  };
  function clearErrors(path: BodyPath) {
    for (const key of errors.current.keys())
      if (bodyPathWithin(key, path)) errors.current.delete(key);
    report.current(errors.current.values().next().value ?? '');
  }
  const branchActions = {
    select(path: BodyPath, index: number | undefined) {
      setSelections((current) => {
        const next = new Map(
          [...current].filter(([key]) => !bodyPathWithin(key, path)),
        );
        if (index !== undefined) next.set(JSON.stringify(path), index);
        return next;
      });
      clearErrors(path);
    },
    reset(path: BodyPath) {
      setSelections(
        (current) =>
          new Map(
            [...current].filter(([key]) => !bodyPathWithin(key, path, true)),
          ),
      );
      clearErrors(path);
    },
  };
  return (
    <BranchContext.Provider value={branchActions}>
      <div className="body-editor">
        {variants && (
          <div className="body-variant-selector">
            <label>
              Editing schema ({variants.keyword})
              <select
                aria-label="Request body schema branch"
                value={variant === undefined ? '' : String(variant)}
                onChange={(event) => {
                  setVariant(
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                  );
                  setRevision((value) => value + 1);
                  setSelections(new Map());
                  errors.current.clear();
                  report.current('');
                }}
              >
                <option value="">Choose a branch for field controls</option>
                {variants.choices.map((choice, index) => (
                  <option key={index} value={index}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="subtle">
              Selecting a schema changes the field controls, not the request
              body. Existing values are retained. This does not validate which
              branches match.
            </p>
          </div>
        )}
        <div
          className="body-editor-modes"
          role="group"
          aria-label="Request body editor"
        >
          <button
            type="button"
            aria-pressed={shownMode === 'json'}
            onClick={() => {
              setMode('json');
              setSelections(new Map());
            }}
          >
            JSON
          </button>
          <button
            type="button"
            aria-pressed={shownMode === 'table'}
            disabled={
              !available ||
              !('fields' in model) ||
              model.value.entries.length > 100 ||
              model.value.entries.some(([name]) => !name)
            }
            onClick={() => setMode('table')}
          >
            Table
          </button>
          <button
            type="button"
            aria-pressed={shownMode === 'fields'}
            disabled={!available || ('fields' in model && !model.fields.length)}
            onClick={() => setMode('fields')}
          >
            Fields
          </button>
        </div>
        {shownMode === 'json' || !available ? (
          <>
            <label>
              Request body
              <textarea
                aria-label="Request body"
                value={body}
                spellCheck={false}
                rows={8}
                onChange={(event) => onChange(event.target.value)}
              />
            </label>
            {!available && <p className="subtle">{model.error}</p>}
          </>
        ) : shownMode === 'table' && 'fields' in model ? (
          <BodyTable
            key={revision}
            value={model.value}
            fields={model.tableFields}
            onChange={onChange}
            onError={(error) => fieldError('table', error)}
          />
        ) : (
          <fieldset className="body-fields" key={revision}>
            <legend>Request fields</legend>
            <p className="subtle">
              Complex schemas use JSON. Unknown and read-only values are
              retained; edit them in JSON. Required fields and schema
              constraints still apply.
            </p>
            {'fields' in model ? (
              <ObjectFields
                model={model}
                onChange={(value) => onChange(serializeJsonValue(value, true))}
                onError={fieldError}
              />
            ) : (
              <ArrayFields
                model={model}
                path={[]}
                onChange={(value) => onChange(serializeJsonValue(value, true))}
                onError={fieldError}
              />
            )}
            {errors.current.size > 0 && (
              <p className="subtle">
                Fix incomplete field values before sending, or return to JSON to
                use the last valid values.
              </p>
            )}
          </fieldset>
        )}
      </div>
    </BranchContext.Provider>
  );
}
