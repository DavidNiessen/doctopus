import { useId } from 'react';
import type { Parameter } from '@davidniessen/doctopus-contracts';
import { useUi } from '../ui-translation.js';

export function ParameterInput({
  parameter,
  value,
  presence,
  allowEmpty,
  qualified,
  onChange,
  onPresence,
}: {
  parameter: Parameter;
  value: string;
  presence: boolean | undefined;
  allowEmpty: boolean;
  qualified: boolean;
  onChange: (value: string) => void;
  onPresence: (value: boolean | undefined) => void;
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
  return (
    <div className="parameter-input">
      <label htmlFor={id}>
        <span>
          <code>{parameter.name}</code>
          <small>
            {parameter.in}
            {parameter.required ? ' · ' + t('schema.required') : ''}
          </small>
        </span>
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
      </label>
      {(!parameter.required || allowEmpty) && (
        <label className="parameter-presence">
          <input
            type="checkbox"
            aria-label={t('parameter.presenceLabel', {
              action: t(
                parameter.required
                  ? 'parameter.allowEmpty'
                  : 'parameter.include',
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
          <span>
            {t(
              parameter.required ? 'parameter.allowEmpty' : 'parameter.include',
            )}
          </span>
        </label>
      )}
      {hint && (
        <p id={id + '-presence'} className="parameter-presence-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
