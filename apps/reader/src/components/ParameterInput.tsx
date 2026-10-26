import { useId } from 'react';
import type { Parameter } from '@davidniessen/doctopus-contracts';
import { useUi } from '../ui-translation.js';

export function ParameterInput({
  parameter,
  value,
  qualified,
  onChange,
  compact = false,
}: {
  parameter: Parameter;
  value: string;
  qualified: boolean;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const id = useId();
  const t = useUi();
  const missing = parameter.required && !value.trim();
  const input = (
    <input
      id={id}
      aria-label={
        qualified
          ? t('parameter.qualifiedLabel', {
              name: parameter.name,
              location: parameter.in,
            })
          : t('parameter.label', { name: parameter.name })
      }
      aria-required={parameter.required}
      aria-invalid={missing || undefined}
      aria-describedby={missing ? id + '-error' : undefined}
      value={value}
      placeholder={
        parameter.schema.type === 'array'
          ? '["value"]'
          : parameter.schema.type === 'object'
            ? '{"key":"value"}'
            : t('parameter.value')
      }
      onChange={(event) => onChange(event.target.value)}
    />
  );
  const heading = (
    <span className="parameter-name" title={parameter.description}>
      <span className="request-field-heading">
        <code>{parameter.name}</code>
        <span className="request-type-badge">
          {String(parameter.schema.type ?? 'string')}
        </span>
        {parameter.required && (
          <span className="request-required-badge">{t('schema.required')}</span>
        )}
      </span>
      {parameter.description && (
        <span className="request-field-description">
          {parameter.description}
        </span>
      )}
    </span>
  );
  if (compact)
    return (
      <div className="request-form-field" data-parameter-row="documented">
        <label htmlFor={id} className="request-field-meta">
          {heading}
        </label>
        <div className="request-field-control">
          {input}
          {missing && (
            <p id={id + '-error'} className="request-field-error">
              {t('parameter.requiredValue', { name: parameter.name })}
            </p>
          )}
        </div>
      </div>
    );
  return (
    <div className="parameter-input">
      <label htmlFor={id}>
        {heading}
        {input}
      </label>
      {missing && (
        <p id={id + '-error'} className="request-field-error">
          {t('parameter.requiredValue', { name: parameter.name })}
        </p>
      )}
    </div>
  );
}
