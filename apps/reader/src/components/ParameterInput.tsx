import { useId } from 'react';
import type { Parameter } from '@davidniessen/doctopus-contracts';
import { useUi } from '../ui-translation.js';
import { Icon } from './Icon.js';

export function ParameterInput({
  parameter,
  value,
  presence,
  allowEmpty,
  qualified,
  onChange,
  onPresence,
  compact = false,
  onRemove,
}: {
  parameter: Parameter;
  value: string;
  presence: boolean | undefined;
  allowEmpty: boolean;
  qualified: boolean;
  onChange: (value: string) => void;
  onPresence: (value: boolean | undefined) => void;
  compact?: boolean;
  onRemove?: () => void;
}) {
  const id = useId();
  const t = useUi();
  const included = presence ?? value !== '';
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
  const toggle =
    !parameter.required || allowEmpty ? (
      <label className="parameter-presence">
        <input
          type="checkbox"
          aria-label={t('parameter.presenceLabel', {
            action: t(
              parameter.required ? 'parameter.allowEmpty' : 'parameter.include',
            ),
            location: parameter.in,
            name: parameter.name,
          })}
          checked={parameter.required ? presence === true : included}
          onChange={(event) =>
            onPresence(
              parameter.required && !event.target.checked
                ? undefined
                : event.target.checked,
            )
          }
        />
        <span className="sr-only">
          {t(parameter.required ? 'parameter.allowEmpty' : 'parameter.include')}
        </span>
      </label>
    ) : compact ? (
      <span className="parameter-required" title={t('schema.required')}>
        <Icon name="lock" size={13} />
      </span>
    ) : null;
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
          <div className="request-field-actions">
            {toggle}
            {onRemove && (
              <button
                type="button"
                className="parameter-remove"
                disabled={parameter.required}
                aria-label={t('parameter.remove', {
                  location: parameter.in,
                  name: parameter.name,
                })}
                title={parameter.required ? t('schema.required') : undefined}
                onClick={onRemove}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  return (
    <div className="parameter-input">
      <label htmlFor={id}>
        {heading}
        {input}
      </label>
      {toggle}
    </div>
  );
}
