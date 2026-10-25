import { useRef, useState } from 'react';
import type { Parameter } from '@davidniessen/doctopus-contracts';
import { isSensitiveAdditionalParameter } from '@davidniessen/doctopus-explorer';
import type { ParameterDraft } from '../parameter-drafts.js';
import { useUi } from '../ui-translation.js';
import { Icon } from './Icon.js';
import { ParameterInput } from './ParameterInput.js';

export function ParameterForm({
  location,
  declared,
  removed,
  values,
  presence,
  empty,
  qualified,
  rows,
  onValue,
  onPresence,
  onRemoveDeclared,
  onRestore,
  onEdit,
  onRemove,
}: {
  location: 'query' | 'header';
  declared: Parameter[];
  removed: ReadonlySet<string>;
  values: Readonly<Record<string, string>>;
  presence: Readonly<Record<string, boolean>>;
  empty: ReadonlySet<string>;
  qualified: ReadonlySet<string>;
  rows: ParameterDraft[];
  onValue: (key: string, value: string) => void;
  onPresence: (key: string, value: boolean | undefined) => void;
  onRemoveDeclared: (key: string) => void;
  onRestore: () => void;
  onEdit: (
    id: number,
    patch: Partial<Pick<ParameterDraft, 'name' | 'value' | 'enabled'>>,
  ) => void;
  onRemove: (id: number) => void;
}) {
  const t = useUi();
  const root = useRef<HTMLDetailsElement>(null);
  const [activeBlank, setActiveBlank] = useState<number>();
  return (
    <details
      className="request-form-section request-parameter-section"
      open={declared.length > 0}
      ref={root}
    >
      <summary>
        {t(
          location === 'query'
            ? 'parameter.queryHeading'
            : 'parameter.headerHeading',
        )}
      </summary>
      {declared
        .filter((parameter) => !removed.has(`${location}:${parameter.name}`))
        .map((parameter) => {
          const key = `${location}:${parameter.name}`;
          return (
            <ParameterInput
              key={key}
              compact
              parameter={parameter}
              value={values[key] ?? ''}
              presence={presence[key]}
              allowEmpty={empty.has(key)}
              qualified={qualified.has(parameter.name)}
              onChange={(value) => onValue(key, value)}
              onPresence={(value) => onPresence(key, value)}
              onRemove={() => {
                onRemoveDeclared(key);
                requestAnimationFrame(() => {
                  const target =
                    root.current?.querySelector<HTMLElement>(
                      '.additional-parameter-name',
                    ) ??
                    root.current?.querySelector<HTMLElement>(
                      '.request-form-actions button',
                    );
                  target?.focus();
                });
              }}
            />
          );
        })}
      {rows.map((row, offset) => {
        const index = String(offset + 1);
        if (!row.name && !row.value && activeBlank !== row.id) return null;
        return (
          <div
            key={row.id}
            className="request-form-field request-custom-field"
            data-parameter-row="additional"
            role="group"
            aria-label={t('parameter.customRow', { location, index })}
          >
            <div className="request-field-meta">
              <input
                className="additional-parameter-name"
                data-unused={!row.name && !row.value}
                value={row.name}
                placeholder={t('parameter.key')}
                aria-label={t('parameter.customName', { location, index })}
                spellCheck={false}
                onChange={(event) =>
                  onEdit(row.id, { name: event.target.value })
                }
              />
              <span className="request-type-badge">string</span>
            </div>
            <div className="request-field-control">
              <input
                value={row.value}
                type={
                  isSensitiveAdditionalParameter(row.name) ? 'password' : 'text'
                }
                autoComplete="off"
                placeholder={t('parameter.customValue')}
                aria-label={t('parameter.customValueLabel', {
                  location,
                  index,
                })}
                spellCheck={false}
                onChange={(event) =>
                  onEdit(row.id, { value: event.target.value })
                }
              />
              <div className="request-field-actions">
                <label className="parameter-presence">
                  <input
                    type="checkbox"
                    checked={row.enabled !== false}
                    disabled={!row.name}
                    aria-label={t('parameter.customInclude', {
                      location,
                      index,
                    })}
                    onChange={(event) =>
                      onEdit(row.id, { enabled: event.target.checked })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="parameter-remove"
                  disabled={!row.name && !row.value}
                  aria-label={t('parameter.customRemove', { location, index })}
                  onClick={(event) => {
                    const next = event.currentTarget.closest(
                      '.request-form-field',
                    )?.nextElementSibling;
                    onRemove(row.id);
                    requestAnimationFrame(() => {
                      const target =
                        next?.querySelector<HTMLInputElement>(
                          'input:not([type="checkbox"])',
                        ) ??
                        root.current?.querySelector<HTMLInputElement>(
                          '.additional-parameter-name',
                        ) ??
                        root.current?.querySelector<HTMLButtonElement>(
                          '.request-form-actions button',
                        );
                      target?.focus();
                    });
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <div className="request-form-actions">
        <button
          type="button"
          onClick={() => {
            if (root.current) root.current.open = true;
            const blank = rows.find((row) => !row.name && !row.value);
            if (blank) setActiveBlank(blank.id);
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLInputElement>(
                  '.additional-parameter-name[data-unused="true"]',
                )
                ?.focus(),
            );
          }}
        >
          <Icon name="plus" size={14} />
          {t('parameter.add', { location })}
        </button>
        {declared.some((parameter) =>
          removed.has(`${location}:${parameter.name}`),
        ) && (
          <button type="button" onClick={onRestore}>
            {t('parameter.restore')}
          </button>
        )}
      </div>
    </details>
  );
}
