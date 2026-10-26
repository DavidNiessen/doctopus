import type { Parameter } from '@davidniessen/doctopus-contracts';
import { useUi } from '../ui-translation.js';
import { ParameterInput } from './ParameterInput.js';
export function ParameterForm({
  location,
  declared,
  values,
  qualified,
  onValue,
}: {
  location: 'query' | 'header';
  declared: Parameter[];
  values: Readonly<Record<string, string>>;
  qualified: ReadonlySet<string>;
  onValue: (key: string, value: string) => void;
}) {
  const t = useUi();
  if (!declared.length) return null;
  return (
    <details className="request-form-section request-parameter-section" open>
      <summary>
        {t(
          location === 'query'
            ? 'parameter.queryHeading'
            : 'parameter.headerHeading',
        )}
      </summary>
      {declared.map((parameter) => (
        <ParameterInput
          key={parameter.name}
          compact
          parameter={parameter}
          value={values[`${location}:${parameter.name}`] ?? ''}
          qualified={qualified.has(parameter.name)}
          onChange={(value) => onValue(`${location}:${parameter.name}`, value)}
        />
      ))}
    </details>
  );
}
