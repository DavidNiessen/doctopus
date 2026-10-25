import { useState } from 'react';
import {
  exampleChoices,
  formatExample,
  hasExternalExamples,
  isJsonMediaType,
} from '@davidniessen/doctopus-contracts';
import type { Media, Schema } from '@davidniessen/doctopus-contracts';
import { CodeBlock } from './CodeBlock.js';
import { useUi } from '../ui-translation.js';
export function MediaExamples({
  media,
  mediaType,
  schemas,
  title,
  selectedId,
  onSelect,
  toolbar = true,
}: {
  media: Media;
  mediaType: string;
  schemas: Record<string, Schema>;
  title?: string;
  selectedId?: string | undefined;
  onSelect?: (id: string) => void;
  toolbar?: boolean;
}) {
  const t = useUi();
  const heading = title ?? t('examples.responseTitle');
  const choices = exampleChoices(media, schemas);
  const [selected, setSelected] = useState(choices[0]!.id);
  const example =
    choices.find(
      (choice) => choice.id === (onSelect ? selectedId : selected),
    ) ?? choices[0]!;
  return (
    <>
      {(choices.length > 1 || choices[0]!.id.startsWith('named:')) && (
        <label className="example-selector">
          {title ?? t('examples.responseSelector')}
          <select
            value={example.id}
            onChange={(event) => {
              setSelected(event.target.value);
              onSelect?.(event.target.value);
            }}
          >
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.id === 'inline'
                  ? t('examples.inline')
                  : choice.id === 'generated'
                    ? t('examples.generated')
                    : choice.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {hasExternalExamples(media) && (
        <p className="example-note">{t('examples.external')}</p>
      )}
      <CodeBlock
        toolbar={toolbar}
        code={formatExample(example.value, mediaType)}
        title={
          example.id === 'generated'
            ? t('examples.generatedTitle', { title: heading })
            : heading
        }
        language={
          isJsonMediaType(mediaType)
            ? 'json'
            : (mediaType.split('/').at(-1) ?? 'text')
        }
      />
    </>
  );
}
