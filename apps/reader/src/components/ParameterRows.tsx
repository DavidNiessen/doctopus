import { useRef } from 'react';
import type { Parameter } from '@davidniessen/doctopus-contracts';
import { isSensitiveAdditionalParameter } from '@davidniessen/doctopus-explorer';
import type { ParameterDraft } from '../parameter-drafts.js';
import { useUi } from '../ui-translation.js';
import { Icon } from './Icon.js';
import { ParameterInput } from './ParameterInput.js';

export function ParameterRows({
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
  return (
    <details className="request-parameter-section" open ref={root}>
      <summary>
        {t(
          location === 'query'
            ? 'parameter.queryHeading'
            : 'parameter.headerHeading',
        )}
      </summary>
      <div className="request-parameter-columns" aria-hidden="true">
        <span /> <span>{t('parameter.key')}</span>
        <span>{t('parameter.customValue')}</span>
        <span />
      </div>
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
                requestAnimationFrame(() =>
                  root.current
                    ?.querySelector<HTMLInputElement>(
                      '.additional-parameter-name',
                    )
                    ?.focus(),
                );
              }}
            />
          );
        })}
      {rows.map((row, offset) => {
        const index = String(offset + 1);
        return (
          <div
            key={row.id}
            className="request-parameter-row"
            data-parameter-row="additional"
            role="group"
            aria-label={t('parameter.customRow', { location, index })}
          >
            <label className="parameter-presence">
              <input
                type="checkbox"
                checked={row.enabled !== false}
                disabled={!row.name}
                aria-label={t('parameter.customInclude', { location, index })}
                onChange={(event) =>
                  onEdit(row.id, { enabled: event.target.checked })
                }
              />
            </label>
            <input
              className="additional-parameter-name"
              value={row.name}
              placeholder={t('parameter.key')}
              aria-label={t('parameter.customName', { location, index })}
              spellCheck={false}
              onChange={(event) => onEdit(row.id, { name: event.target.value })}
            />
            <input
              value={row.value}
              type={
                isSensitiveAdditionalParameter(row.name) ? 'password' : 'text'
              }
              autoComplete="off"
              placeholder={t('parameter.customValue')}
              aria-label={t('parameter.customValueLabel', { location, index })}
              spellCheck={false}
              onChange={(event) =>
                onEdit(row.id, { value: event.target.value })
              }
            />
            <button
              type="button"
              className="parameter-remove"
              disabled={!row.name && !row.value}
              aria-label={t('parameter.customRemove', { location, index })}
              onClick={(event) => {
                const next = event.currentTarget.closest(
                  '.request-parameter-row',
                )?.nextElementSibling;
                onRemove(row.id);
                requestAnimationFrame(() => {
                  const target =
                    next?.querySelector<HTMLInputElement>(
                      'input:not([type="checkbox"])',
                    ) ??
                    root.current?.querySelector<HTMLInputElement>(
                      '.additional-parameter-name',
                    );
                  target?.focus();
                });
              }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
      <div className="parameter-row-actions">
        <button
          type="button"
          onClick={() => {
            if (root.current) root.current.open = true;
            root.current
              ?.querySelectorAll<HTMLInputElement>('.additional-parameter-name')
              .item(rows.length - 1)
              ?.focus();
          }}
        >
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
