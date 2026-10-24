import { useMemo, useState } from 'react';
import { resolveSchema } from '@davidniessen/doctopus-contracts';
import type { Media, Schema } from '@davidniessen/doctopus-contracts';
import { multipartHeaderFields } from '@davidniessen/doctopus-explorer';
import type {
  MultipartFiles,
  MultipartHeaders,
} from '@davidniessen/doctopus-explorer';
import { multipartEditorModel } from '../multipart-input.js';
import { BodyEditor } from './BodyEditor.js';

export function MultipartBodyEditor({
  body,
  media,
  schemas,
  legacy,
  files,
  partHeaders,
  onHeaders,
  onFiles,
  onChange,
  onError,
}: {
  body: string;
  media: Media;
  schemas: Record<string, Schema>;
  legacy: boolean;
  files: MultipartFiles;
  partHeaders: MultipartHeaders;
  onHeaders: (headers: MultipartHeaders) => void;
  onFiles: (files: MultipartFiles) => void;
  onChange: (value: string) => void;
  onError: (error: string) => void;
}) {
  const [revision, setRevision] = useState(() => new Map<string, number>());
  const model = useMemo(() => {
    try {
      const headers = multipartHeaderFields(media, {
        schemas,
        openapiVersion: legacy ? '3.0' : '3.1',
      });
      if (headers.length > 100)
        throw new Error(
          'The playground supports at most 100 part-header controls. Use a custom client for larger definitions.',
        );
      return { value: multipartEditorModel(media, schemas, legacy), headers };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : 'Multipart fields are unavailable.',
      };
    }
  }, [media, schemas, legacy]);
  if (!model.value)
    return (
      <p className="preview-error" role="alert">
        {model.error}
      </p>
    );
  return (
    <div className="multipart-editor">
      <p className="subtle">
        Edit text values below and choose local files separately. Up to 100
        parts and 32 MiB including headers. Files are sent only when you choose
        Send request.
      </p>
      {model.headers?.length ? (
        <fieldset className="multipart-part-headers">
          <legend>Part headers</legend>
          <p className="subtle">
            Blank values omit a header. Copied examples hide all custom
            part-header values.
          </p>
          {model.headers.map(({ field, parameter }) => {
            const schema = resolveSchema(parameter.schema, schemas, {
              ignoreReferenceSiblings: legacy,
            });
            const values = Object.hasOwn(partHeaders, field)
              ? partHeaders[field]
              : undefined;
            const value =
              values && Object.hasOwn(values, parameter.name)
                ? values[parameter.name]
                : '';
            return (
              <label key={JSON.stringify([field, parameter.name])}>
                {field} · {parameter.name}
                {parameter.required && (
                  <span className="required">
                    required when part is present
                  </span>
                )}
                <input
                  aria-label={`Part ${field} header ${parameter.name}`}
                  type={
                    schema.writeOnly === true ||
                    schema.format === 'password' ||
                    /authorization|api[-_]?key|secret|token|password/i.test(
                      parameter.name,
                    )
                      ? 'password'
                      : 'text'
                  }
                  value={value ?? ''}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    onHeaders({
                      ...partHeaders,
                      [field]: {
                        ...values,
                        [parameter.name]: event.target.value,
                      },
                    })
                  }
                />
                {parameter.description && (
                  <span className="subtle">{parameter.description}</span>
                )}
              </label>
            );
          })}
        </fieldset>
      ) : null}
      {model.value.files.map((field) => {
        const selected = Object.hasOwn(files, field.name)
          ? (files[field.name] ?? [])
          : [];
        return (
          <div className="multipart-file" key={field.name}>
            <label>
              <span>
                <code>{field.name}</code>
                <small>
                  {field.multiple ? 'multiple files' : 'file'}
                  {field.required ? ' · required' : ''}
                </small>
              </span>
              <input
                key={revision.get(field.name) ?? 0}
                type="file"
                aria-label={`Upload ${field.name}`}
                multiple={field.multiple}
                required={field.required}
                onChange={(event) =>
                  onFiles({
                    ...files,
                    [field.name]: Array.from(
                      event.target.files ?? [],
                      (file) => ({ filename: file.name, data: file }),
                    ),
                  })
                }
              />
            </label>
            {field.description && <p className="subtle">{field.description}</p>}
            {selected.length > 0 && (
              <div className="multipart-selection">
                <span>
                  {selected.length} selected ·{' '}
                  {selected
                    .reduce((total, file) => total + file.data.size, 0)
                    .toLocaleString('en-US')}{' '}
                  bytes
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onFiles({ ...files, [field.name]: [] });
                    setRevision((current) =>
                      new Map(current).set(
                        field.name,
                        (current.get(field.name) ?? 0) + 1,
                      ),
                    );
                  }}
                >
                  Clear {field.name}
                </button>
              </div>
            )}
          </div>
        );
      })}
      <BodyEditor
        body={body}
        schema={model.value.textSchema}
        schemas={schemas}
        legacy={legacy}
        allowVariants={false}
        initialMode="fields"
        onChange={onChange}
        onError={onError}
      />
    </div>
  );
}
