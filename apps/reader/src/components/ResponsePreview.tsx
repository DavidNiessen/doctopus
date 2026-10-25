import {
  exampleChoices,
  formatExample,
} from '@davidniessen/doctopus-contracts';
import type { ApiDocument, Operation } from '@davidniessen/doctopus-contracts';
import { CopyButton } from './CopyButton.js';
import { MediaExamples } from './MediaExamples.js';
import { useResponseSelection } from './ResponseSelection.js';
import { useUi } from '../ui-translation.js';

export function ResponsePreview({
  api,
  operation,
}: {
  api: ApiDocument;
  operation: Operation;
}) {
  const t = useUi();
  const selection = useResponseSelection(operation);
  const media = selection.response?.content[selection.type];
  const choices = media ? exampleChoices(media, api.schemas) : [];
  const example =
    choices.find((item) => item.id === selection.example) ?? choices[0];
  const code = example ? formatExample(example.value, selection.type) : '';
  return (
    <aside
      className="response-preview"
      aria-label={t('examples.responseTitle')}
    >
      <div className="response-preview-toolbar">
        <div className="response-preview-statuses">
          {operation.responses.map((response) => (
            <button
              key={response.status}
              type="button"
              className={selection.status === response.status ? 'active' : ''}
              aria-label={`${t('response.title')} ${response.status}`}
              aria-pressed={selection.status === response.status}
              onClick={() => selection.setStatus(response.status)}
            >
              {response.status}
            </button>
          ))}
        </div>
        <CopyButton text={code} label={t('code.copyLabel')} disabled={!code} />
      </div>
      {selection.types.length > 1 && (
        <label className="response-preview-format">
          {t('api.responseContentType')}
          <select
            value={selection.type}
            onChange={(event) => selection.setType(event.target.value)}
          >
            {selection.types.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
      )}
      {media ? (
        <MediaExamples
          key={`${selection.status}:${selection.type}`}
          media={media}
          mediaType={selection.type}
          schemas={api.schemas}
          selectedId={selection.example}
          onSelect={selection.setExample}
          toolbar={false}
        />
      ) : (
        <p className="response-preview-empty">
          {selection.response?.description ?? t('api.noResponses')}
        </p>
      )}
    </aside>
  );
}
