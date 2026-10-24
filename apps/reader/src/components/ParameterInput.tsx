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
  const hint =
    !parameter.required && !included && value
      ? t('parameter.omitted')
      : included && value === ''
        ? t('parameter.empty')
        : '';
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
      aria-describedby={hint ? id + '-presence' : undefined}
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
        <span className={compact ? 'sr-only' : undefined}>
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
      <code>{parameter.name}</code>
      <small>
        {parameter.in}
        {parameter.required ? ' · ' + t('schema.required') : ''}
      </small>
    </span>
  );
  const help = hint ? (
    <p id={id + '-presence'} className="parameter-presence-hint">
      {hint}
    </p>
  ) : null;
  if (compact)
    return (
      <div className="request-parameter-row" data-parameter-row="documented">
        {toggle}
        <label htmlFor={id}>{heading}</label>
        {input}
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
        {help}
      </div>
    );
  return (
    <div className="parameter-input">
      <label htmlFor={id}>
        {heading}
        {input}
      </label>
      {toggle}
      {help}
    </div>
  );
}
