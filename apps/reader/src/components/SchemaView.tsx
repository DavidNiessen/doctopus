import { resolveSchema } from '@davidniessen/doctopus-contracts';
import type { Schema, UiText } from '@davidniessen/doctopus-contracts';
import { useUi } from '../ui-translation.js';
const object = (value: unknown): Schema =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : {};
const asSchema = (value: unknown): Schema =>
  typeof value === 'boolean'
    ? { 'x-doctopus-boolean-schema': value }
    : object(value);
function typeLabel(schema: Schema, legacyNullable: boolean, t: UiText): string {
  if (schema['x-doctopus-boolean-schema'] !== undefined)
    return schema['x-doctopus-boolean-schema']
      ? t('schema.anyValue')
      : t('schema.noValue');
  if (schema.$ref)
    return String(schema.$ref).split('/').pop() ?? t('schema.reference');
  const types = Array.isArray(schema.type)
    ? [...schema.type]
    : [
        schema.type ??
          (schema.properties
            ? 'object'
            : schema.items || schema.prefixItems
              ? 'array'
              : schema.oneOf
                ? t('schema.oneOfType')
                : schema.anyOf
                  ? t('schema.anyOfType')
                  : schema.allOf
                    ? t('schema.allOfType')
                    : t('schema.anyType')),
      ];
  if (
    legacyNullable &&
    typeof schema.type === 'string' &&
    schema.nullable === true &&
    !types.includes('null')
  )
    types.push('null');
  return (
    types.join(' | ') + (schema.format ? ` · ${String(schema.format)}` : '')
  );
}
const constraintKeys = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minContains',
  'maxContains',
  'minProperties',
  'maxProperties',
  'dependentRequired',
  'const',
  'default',
  'readOnly',
  'writeOnly',
  'deprecated',
  'required',
  'discriminator',
];
function SchemaMetadata({
  schema,
  hideDeprecated,
}: {
  schema: Schema;
  hideDeprecated: boolean;
}) {
  const t = useUi();
  const keys = constraintKeys.filter(
    (key) =>
      schema[key] !== undefined && !(hideDeprecated && key === 'deprecated'),
  );
  return (
    <>
      {Array.isArray(schema.enum) && (
        <div className="schema-enum">
          {t('schema.allowed')}{' '}
          {schema.enum.map((value, index) => (
            <code key={index}>{JSON.stringify(value)}</code>
          ))}
        </div>
      )}
      {keys.length > 0 && (
        <dl className="schema-constraints">
          {keys.map((key) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                <code>{JSON.stringify(schema[key])}</code>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
const variants = {
  oneOf: 'schema.oneOf',
  anyOf: 'schema.anyOf',
  allOf: 'schema.allOf',
} as const;
const childKeywords = {
  items: 'schema.items',
  contains: 'schema.contains',
  propertyNames: 'schema.propertyNames',
  additionalProperties: 'schema.additionalProperties',
  unevaluatedProperties: 'schema.unevaluatedProperties',
  unevaluatedItems: 'schema.unevaluatedItems',
  not: 'schema.not',
  if: 'schema.if',
  then: 'schema.then',
  else: 'schema.else',
} as const;
export function SchemaView({
  schema,
  schemas,
  depth = 0,
  visited = new Set<string>(),
  hideHeading = false,
  legacyNullable = false,
}: {
  schema: Schema;
  schemas: Record<string, Schema>;
  depth?: number;
  visited?: Set<string>;
  hideHeading?: boolean;
  legacyNullable?: boolean;
}) {
  const t = useUi();
  const ref = typeof schema.$ref === 'string' ? schema.$ref : '';
  if (ref && visited.has(ref))
    return (
      <p className="schema-recursive">
        {t('schema.recursive')} <code>{ref.split('/').pop() ?? 'schema'}</code>
      </p>
    );
  if (depth > 6) return <p className="schema-recursive">{t('schema.depth')}</p>;
  const next = new Set(visited);
  if (ref) next.add(ref);
  const actual = resolveSchema(schema, schemas, {
    ignoreReferenceSiblings: legacyNullable,
  });
  const required = Array.isArray(actual.required) ? actual.required : [];
  const properties = Object.entries(object(actual.properties));
  return (
    <div className="schema-view schema-leaf">
      {!hideHeading && (
        <>
          <span className="type-label">
            {typeLabel(actual, legacyNullable, t)}
          </span>
          {typeof actual.description === 'string' && (
            <p>{actual.description}</p>
          )}
        </>
      )}
      <SchemaMetadata schema={actual} hideDeprecated={hideHeading} />
      {properties.length > 0 && (
        <div className="schema-fields">
          {properties.map(([name, value]) => {
            const property = asSchema(value),
              resolved = resolveSchema(property, schemas, {
                ignoreReferenceSiblings: legacyNullable,
              });
            const nested =
              resolved.$ref ||
              Object.hasOwn(resolved, 'properties') ||
              Object.hasOwn(resolved, 'items') ||
              Object.hasOwn(resolved, 'prefixItems') ||
              Object.keys(variants).some((key) =>
                Array.isArray(resolved[key]),
              ) ||
              Object.keys(childKeywords).some((key) =>
                Object.hasOwn(resolved, key),
              );
            return (
              <div className="schema-field" key={name}>
                <div className="field-heading">
                  <code>{name}</code>
                  <span className="type-label">
                    {typeLabel(resolved, legacyNullable, t)}
                  </span>
                  {required.includes(name) && (
                    <span className="required">{t('schema.required')}</span>
                  )}
                  {resolved.deprecated === true && (
                    <span className="deprecated-label">
                      {t('schema.deprecated')}
                    </span>
                  )}
                </div>
                {typeof resolved.description === 'string' && (
                  <p>{resolved.description}</p>
                )}
                {nested ? (
                  <details>
                    <summary>{t('schema.showChildren')}</summary>
                    <SchemaView
                      schema={property}
                      schemas={schemas}
                      depth={depth + 1}
                      visited={next}
                      legacyNullable={legacyNullable}
                      hideHeading
                    />
                  </details>
                ) : (
                  <SchemaView
                    schema={property}
                    schemas={schemas}
                    depth={depth + 1}
                    visited={next}
                    legacyNullable={legacyNullable}
                    hideHeading
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {Object.entries(variants).map(
        ([keyword, description]) =>
          Array.isArray(actual[keyword]) && (
            <div className="schema-variants" key={keyword}>
              <p>{t(description)}</p>
              {(actual[keyword] as unknown[]).map((variant, index) => (
                <details key={index} open={index === 0}>
                  <summary>
                    {t('schema.variant', { number: index + 1 })}{' '}
                    <span className="type-label">
                      {typeLabel(asSchema(variant), legacyNullable, t)}
                    </span>
                  </summary>
                  <SchemaView
                    schema={asSchema(variant)}
                    schemas={schemas}
                    depth={depth + 1}
                    visited={next}
                    legacyNullable={legacyNullable}
                  />
                </details>
              ))}
            </div>
          ),
      )}
      {Array.isArray(actual.prefixItems) && (
        <div className="schema-array">
          <p>{t('schema.tuple')}</p>
          {actual.prefixItems.map((item, index) => (
            <details key={index}>
              <summary>
                {t('schema.position', { number: index + 1 })}{' '}
                <span className="type-label">
                  {typeLabel(asSchema(item), legacyNullable, t)}
                </span>
              </summary>
              <SchemaView
                schema={asSchema(item)}
                schemas={schemas}
                depth={depth + 1}
                visited={next}
                legacyNullable={legacyNullable}
              />
            </details>
          ))}
        </div>
      )}
      {Object.entries(childKeywords).map(
        ([keyword, label]) =>
          Object.hasOwn(actual, keyword) && (
            <details key={keyword} className="schema-child">
              <summary>
                {t(label)}{' '}
                <span className="type-label">
                  {typeLabel(asSchema(actual[keyword]), legacyNullable, t)}
                </span>
              </summary>
              <SchemaView
                schema={asSchema(actual[keyword])}
                schemas={schemas}
                depth={depth + 1}
                visited={next}
                legacyNullable={legacyNullable}
              />
            </details>
          ),
      )}
      {(['patternProperties', 'dependentSchemas'] as const).map((keyword) =>
        Object.entries(object(actual[keyword])).map(([name, child]) => (
          <details className="schema-child" key={`${keyword}:${name}`}>
            <summary>
              {keyword === 'patternProperties'
                ? t('schema.pattern')
                : t('schema.dependency')}
              : <code>{name}</code>
            </summary>
            <SchemaView
              schema={asSchema(child)}
              schemas={schemas}
              depth={depth + 1}
              visited={next}
              legacyNullable={legacyNullable}
            />
          </details>
        )),
      )}
    </div>
  );
}
