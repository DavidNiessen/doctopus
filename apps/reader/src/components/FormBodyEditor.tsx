import { useRef, useState } from 'react';
import { encodeFormBody } from '@davidniessen/doctopus-explorer';
import type { Media, Schema } from '@davidniessen/doctopus-contracts';
import { BodyEditor } from './BodyEditor.js';

export function FormBodyEditor({
  body,
  format,
  media,
  schemas,
  openapiVersion,
  onChange,
  onError,
}: {
  body: string;
  format: 'json' | 'serialized';
  media: Media;
  schemas: Record<string, Schema>;
  openapiVersion: string | undefined;
  onChange: (value: string, format: 'json' | 'serialized') => void;
  onError: (error: string) => void;
}) {
  const drafts = useRef<Partial<Record<'json' | 'serialized', string>>>({
    [format]: body,
  });
  const [message, setMessage] = useState('');
  function select(next: 'json' | 'serialized') {
    if (next === format) return;
    drafts.current[format] = body;
    let value = drafts.current[next];
    if (value !== undefined)
      setMessage(
        `Restored the ${next === 'json' ? 'form-values' : 'encoded-body'} draft.`,
      );
    else if (next === 'serialized') {
      try {
        value = encodeFormBody(body, media, { schemas, openapiVersion });
        setMessage('Created an encoded-body draft from the form values.');
      } catch {
        value = '';
        setMessage(
          'Form values could not be converted. Enter your encoded body.',
        );
      }
    } else {
      value = '{}';
      setMessage(
        'Started empty form values. Your encoded-body draft is retained.',
      );
    }
    drafts.current[next] = value;
    onError('');
    onChange(value, next);
  }
  return (
    <div className="form-body-editor">
      <div
        className="body-editor-modes"
        role="group"
        aria-label="Form body input"
      >
        <button
          type="button"
          aria-pressed={format === 'json'}
          onClick={() => select('json')}
        >
          Form values
        </button>
        <button
          type="button"
          aria-pressed={format === 'serialized'}
          onClick={() => select('serialized')}
        >
          Encoded body
        </button>
      </div>
      <p className="subtle">
        Each input keeps its own draft. Switching restores that draft; the
        preview uses the selected input.
      </p>
      {message && (
        <p className="subtle" role="status">
          {message}
        </p>
      )}
      {format === 'json' ? (
        <BodyEditor
          body={body}
          schema={media.schema}
          schemas={schemas}
          legacy={openapiVersion?.startsWith('3.0') ?? false}
          allowVariants={false}
          initialMode="fields"
          onError={onError}
          onChange={(value) => onChange(value, 'json')}
        />
      ) : (
        <>
          <label>
            Encoded form body
            <textarea
              aria-label="Encoded form body"
              rows={8}
              spellCheck={false}
              value={body}
              onChange={(event) => onChange(event.target.value, 'serialized')}
            />
          </label>
          <p className="subtle">
            This text is sent literally. Copied snippets omit its body because
            schema redaction cannot safely reconstruct arbitrary form encodings.
          </p>
        </>
      )}
    </div>
  );
}
