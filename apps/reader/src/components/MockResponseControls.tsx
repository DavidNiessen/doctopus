import { useState } from 'react';
import {
  exampleChoices,
  isJsonMediaType,
} from '@davidniessen/doctopus-contracts';
import type { ApiDocument, Operation } from '@davidniessen/doctopus-contracts';
import { generateMockResponse } from '@davidniessen/doctopus-explorer';
import type { MockResponse } from '@davidniessen/doctopus-explorer';

export function MockResponseControls({
  api,
  operation,
  busy,
  onGenerate,
}: {
  api: ApiDocument;
  operation: Operation;
  busy: boolean;
  onGenerate: (response: MockResponse) => void;
}) {
  const [responseId, setResponseId] = useState(
    () =>
      operation.responses.find((response) =>
        /^2(?:\d\d|XX)$/.test(response.status),
      )?.status ??
      operation.responses[0]?.status ??
      '',
  );
  const [selectedType, setSelectedType] = useState('');
  const [exampleId, setExampleId] = useState('');
  const [seed, setSeed] = useState('example');
  const [error, setError] = useState('');
  if (!operation.responses.length) return null;
  const response =
    operation.responses.find((response) => response.status === responseId) ??
    operation.responses[0]!;
  const types = Object.keys(response.content);
  const contentType = types.includes(selectedType)
    ? selectedType
    : (types.find(isJsonMediaType) ?? types[0]);
  const media = contentType ? response.content[contentType] : undefined;
  const choices = media
    ? exampleChoices({ ...media, schema: {} }).filter(
        (choice) => choice.id !== 'generated',
      )
    : [];
  return (
    <details className="mock-response-controls">
      <summary>Mock response options</summary>
      <p>
        Local examples and seeded schema data. This does not contact the API.
      </p>
      <div className="mock-response-fields">
        <label>
          Response status
          <select
            aria-label="Mock response status"
            value={response.status}
            onChange={(event) => {
              setResponseId(event.target.value);
              setSelectedType('');
              setExampleId('');
              setError('');
            }}
          >
            {operation.responses.map((response) => (
              <option key={response.status} value={response.status}>
                {response.status} · {response.description.slice(0, 80)}
              </option>
            ))}
          </select>
        </label>
        {contentType && (
          <label>
            Media type
            <select
              aria-label="Mock response media type"
              value={contentType}
              onChange={(event) => {
                setSelectedType(event.target.value);
                setExampleId('');
                setError('');
              }}
            >
              {types.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
        )}
        {media && (
          <label>
            Example
            <select
              aria-label="Mock response example"
              value={exampleId}
              onChange={(event) => setExampleId(event.target.value)}
            >
              <option value="">Automatic example</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
              <option value="generated">Generate from schema</option>
            </select>
          </label>
        )}
        <label>
          Seed
          <input
            aria-label="Mock response seed"
            value={seed}
            maxLength={128}
            onChange={(event) => setSeed(event.target.value)}
          />
        </label>
      </div>
      <small>
        The seed applies when generating schema data. Ranges/default statuses
        use a representative HTTP code.
      </small>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setError('');
          try {
            onGenerate(
              generateMockResponse(operation, {
                response: response.status,
                ...(contentType ? { contentType } : {}),
                ...(exampleId ? { exampleId } : {}),
                seed,
                schemas: api.schemas,
                openapiVersion: api.openapiVersion,
              }),
            );
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : 'Unable to generate a mock response.',
            );
          }
        }}
      >
        Generate mock response
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
