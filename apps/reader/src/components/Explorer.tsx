import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  exampleChoices,
  formatExample,
  hasExternalExamples,
  isJsonMediaType,
} from '@davidniessen/doctopus-contracts';
import type {
  ApiDocument,
  Operation,
  Media,
} from '@davidniessen/doctopus-contracts';
import {
  generateSnippet,
  generateMockResponse,
  prepareRequest,
  redactRequest,
  redactJsonBody,
  encodeFormBody,
  isFormMediaType,
  toFetchRequest,
  isMultipartMediaType,
  canSerializeEmptyParameter,
  redactAdditionalParameters,
} from '@davidniessen/doctopus-explorer';
import type {
  PreparedRequest,
  SnippetLanguage,
  MultipartFiles,
  MultipartHeaders,
  MockResponse,
} from '@davidniessen/doctopus-explorer';
import { CodeBlock } from './CodeBlock.js';
import { Icon } from './Icon.js';
import { CopyButton } from './CopyButton.js';
import { PanelResizeHandle } from './PanelResizeHandle.js';
import { RequestUrlBar } from './RequestUrlBar.js';
import { ParameterInput } from './ParameterInput.js';
import { ParameterForm } from './ParameterForm.js';
import {
  createParameterDrafts,
  editParameterDraft,
} from '../parameter-drafts.js';
import { MockResponseControls } from './MockResponseControls.js';

import { AuthField } from './AuthField.js';
import { BodyEditor } from './BodyEditor.js';
import { FormBodyEditor } from './FormBodyEditor.js';
import { MultipartBodyEditor } from './MultipartBodyEditor.js';
import { multipartExampleBody } from '../multipart-input.js';
import { credentialScope } from '../credential-session.js';
import type { CredentialSession } from '../credential-session.js';
import { useCredentials } from '../use-credentials.js';
import { useUi } from '../ui-translation.js';
import { useRelay } from '../use-relay.js';
import { RelayError, sendViaRelay } from '../relay-transport.js';
import { RelayControls } from './RelayControls.js';
import { relayErrorText } from '../auth-messages.js';
const ResponseEditor = lazy(() =>
  import('./ResponseEditor.js').catch(() => ({ default: ResponseFallback })),
);
const snippetLanguages: readonly SnippetLanguage[] = [
  'cURL',
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
];
function ResponseFallback({ body }: { body: string }) {
  const t = useUi();
  return (
    <div className="response-editor">
      <p role="status">{t('response.unavailable')}</p>
      <CopyButton text={body} label={t('response.copy')} />
      <pre tabIndex={0} className="response-fallback">
        {body}
      </pre>
    </div>
  );
}
const bodyInputFormat = (
  type: string,
  value: unknown,
): 'json' | 'serialized' =>
  isMultipartMediaType(type) ||
  (isFormMediaType(type) && typeof value !== 'string')
    ? 'json'
    : 'serialized';
function exampleBody(
  value: unknown,
  type: string,
  media: Media | undefined,
  api: ApiDocument,
): string {
  const body = formatExample(value, type);
  return isMultipartMediaType(type) && media
    ? multipartExampleBody(
        body,
        media,
        api.schemas,
        api.openapiVersion?.startsWith('3.0') ?? false,
      )
    : body;
}
export function Explorer({
  api,
  operation,
  basePath = '',
  oauthClients,
  previewOnly = false,
  onOpen,
  onClose,
  credentialSession,
  relayEndpoint,
  mockOnly = false,
}: {
  api: ApiDocument;
  operation: Operation;
  basePath?: string;
  relayEndpoint?: string | undefined;
  previewOnly?: boolean;
  mockOnly?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  credentialSession?: CredentialSession | undefined;
  oauthClients?:
    Record<string, { clientId: string; issuer: string }> | undefined;
}) {
  const t = useUi();
  const panels = useRef<HTMLDivElement>(null);
  const relay = useRelay(relayEndpoint, !previewOnly && !mockOnly);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(location.origin), []);
  const [server, setServer] = useState(
    operation.servers[0] ?? 'https://api.example.com',
  );
  const [parameterDrafts, setParameterDrafts] = useState(createParameterDrafts);
  const additionalParameters = parameterDrafts.rows;
  const previewAdditionalParameters = useMemo(
    () => redactAdditionalParameters(additionalParameters),
    [additionalParameters],
  );
  const [removedParameters, setRemovedParameters] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [parameters, setParameters] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      operation.parameters
        .filter((parameter) => parameter.required)
        .map((parameter) => {
          const media = Object.entries(parameter.content ?? {})[0];
          if (media)
            return [
              `${parameter.in}:${parameter.name}`,
              formatExample(
                exampleChoices(media[1], api.schemas)[0]!.value,
                media[0],
              ),
            ];
          const value = exampleChoices(parameter, api.schemas)[0]!.value;
          return [
            `${parameter.in}:${parameter.name}`,
            typeof value === 'string' ? value : JSON.stringify(value),
          ];
        }),
    ),
  );
  const emptyParameters = useMemo(
    () =>
      new Set(
        operation.parameters
          .filter(
            (parameter) =>
              parameter.required &&
              canSerializeEmptyParameter(parameter, {
                schemas: api.schemas,
                openapiVersion: api.openapiVersion,
              }),
          )
          .map((parameter) => `${parameter.in}:${parameter.name}`),
      ),
    [operation, api.schemas, api.openapiVersion],
  );
  const [parameterPresence, setParameterPresence] = useState<
    Record<string, boolean>
  >(() =>
    Object.fromEntries(
      operation.parameters
        .filter(
          (parameter) =>
            parameter.required &&
            parameters[`${parameter.in}:${parameter.name}`] === '' &&
            emptyParameters.has(`${parameter.in}:${parameter.name}`),
        )
        .map((parameter) => [`${parameter.in}:${parameter.name}`, true]),
    ),
  );
  const qualifiedParameterNames = useMemo(() => {
    const names = new Set<string>(),
      duplicates = new Set<string>();
    for (const parameter of operation.parameters) {
      if (names.has(parameter.name)) duplicates.add(parameter.name);
      names.add(parameter.name);
    }
    return duplicates;
  }, [operation]);
  const authScope = useMemo(
    () => credentialScope(api, operation, server, oauthClients),
    [
      api.id,
      api.version,
      api.securitySchemes,
      operation.security,
      server,
      oauthClients,
    ],
  );
  const auth = useCredentials(
    previewOnly || mockOnly ? undefined : credentialSession,
    authScope,
  );
  const credentials = auth.credentials;
  const responseTypes = [
    ...new Set(
      operation.responses
        .filter((item) => /^2/.test(item.status))
        .flatMap((item) => Object.keys(item.content)),
    ),
  ];
  const [accept, setAccept] = useState(responseTypes[0] ?? '*/*');
  const [language, setLanguage] = useState('cURL');
  const staticSample = operation.codeSamples?.find(
    (sample) => language === `plugin:${sample.plugin}:${sample.id}`,
  );
  const mediaTypes = Object.keys(operation.requestBody?.content ?? {});
  const [contentType, setContentType] = useState(
    mediaTypes[0] ?? 'application/json',
  );
  const initialMedia = operation.requestBody?.content[mediaTypes[0] ?? ''];
  const initialChoices = initialMedia
    ? exampleChoices(initialMedia, api.schemas)
    : [];
  const [requestExample, setRequestExample] = useState(
    initialChoices[0]?.id ?? '',
  );
  const [body, setBody] = useState(() =>
    initialChoices.length
      ? exampleBody(initialChoices[0]!.value, mediaTypes[0]!, initialMedia, api)
      : '',
  );
  const [bodyFormat, setBodyFormat] = useState<'json' | 'serialized'>(() =>
    bodyInputFormat(mediaTypes[0] ?? '', initialChoices[0]?.value),
  );
  const [bodyRevision, setBodyRevision] = useState(0);
  const [files, setFiles] = useState<MultipartFiles>({});
  const [partHeaders, setPartHeaders] = useState<MultipartHeaders>({});
  const [bodyFormError, setBodyFormError] = useState('');
  const requestMedia = operation.requestBody?.content[contentType];
  const requestChoices = requestMedia
    ? exampleChoices(requestMedia, api.schemas)
    : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<{
    mock?: { source: string; documentedStatus: string };
    status: number;
    duration: number;
    body: string;
    headers: string;
    contentType: string;
  }>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setResponse(undefined);
    setError('');
  }, [auth.resetEpoch, relayEndpoint]);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  const authNames = [
    ...new Set(
      operation.security.flatMap((alternative) => Object.keys(alternative)),
    ),
  ];
  const preview = useMemo(() => {
    try {
      if (bodyFormError) throw new Error(bodyFormError);
      const placeholderCredentials = Object.fromEntries(
        authNames.map((name) => [name, 'YOUR_CREDENTIAL']),
      );
      const request = prepareRequest(operation, api.securitySchemes, {
        server,
        schemas: api.schemas,
        openapiVersion: api.openapiVersion,
        parameters,
        parameterPresence,
        additionalParameters: previewAdditionalParameters,
        body,
        bodyFormat,
        files,
        partHeaders,
        contentType,
        accept,
        credentials: placeholderCredentials,
      });
      if (isFormMediaType(contentType) && request.body !== undefined) {
        request.body = 'YOUR_REQUEST_BODY';
        if (bodyFormat === 'json' && requestMedia) {
          try {
            const redacted = redactJsonBody(
              body,
              {
                schema: requestMedia.schema,
                schemas: api.schemas,
                openapiVersion: api.openapiVersion,
              },
              Object.values(credentials),
            );
            request.body = encodeFormBody(redacted, requestMedia, {
              schemas: api.schemas,
              openapiVersion: api.openapiVersion,
            });
          } catch {
            /* Keep the placeholder when a structured body cannot be safely redacted. */
          }
        }
      }
      return { request, error: '' };
    } catch (error) {
      return {
        request: undefined,
        error: error instanceof Error ? error.message : 'Invalid request',
      };
    }
  }, [
    operation,
    api,
    server,
    parameters,
    parameterPresence,
    previewAdditionalParameters,
    body,
    contentType,
    accept,
    bodyFormError,
    bodyFormat,
    files,
    partHeaders,
    credentials,
    authNames.join(','),
  ]);
  const requestTarget = useMemo(() => {
    try {
      // Resolving a URL must not depend on body validity or selected upload files.
      const targetOperation = { ...operation };
      delete targetOperation.requestBody;
      const target = prepareRequest(targetOperation, api.securitySchemes, {
        server,
        parameters,
        parameterPresence,
        additionalParameters: previewAdditionalParameters,
        schemas: api.schemas,
        openapiVersion: api.openapiVersion,
        credentials: Object.fromEntries(
          authNames.map((name) => [name, 'YOUR_CREDENTIAL']),
        ),
      });
      return redactRequest(target, credentials).url;
    } catch {
      return '';
    }
  }, [
    operation,
    api,
    server,
    parameters,
    parameterPresence,
    previewAdditionalParameters,
    credentials,
    authNames.join(','),
  ]);
  function showMockResponse(result: MockResponse) {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setError('');
    setResponse({
      status: result.status,
      duration: 0,
      body: result.body,
      contentType: result.contentType,
      headers: Object.entries(result.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n'),
      mock: {
        source: result.source,
        documentedStatus: result.documentedStatus,
      },
    });
  }
  async function execute() {
    setError('');
    if (mockOnly) {
      try {
        showMockResponse(
          generateMockResponse(operation, {
            schemas: api.schemas,
            openapiVersion: api.openapiVersion,
          }),
        );
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'Mock response could not be generated.',
        );
      }
      return;
    }
    if (relay.enabled && !relay.policy) {
      setError(t('relay.checkBeforeSend'));
      return;
    }
    if (bodyFormError) {
      setError(bodyFormError);
      return;
    }
    let request: PreparedRequest;
    try {
      request = prepareRequest(operation, api.securitySchemes, {
        server,
        schemas: api.schemas,
        openapiVersion: api.openapiVersion,
        parameters,
        parameterPresence,
        additionalParameters,
        body,
        bodyFormat,
        files,
        partHeaders,
        contentType,
        accept,
        credentials: auth.currentCredentials(),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Invalid request');
      return;
    }
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE'].includes(request.method) &&
      !window.confirm(
        t('playground.confirm', {
          method: request.method,
          origin: new URL(request.url).origin,
        }),
      )
    )
      return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 30_000);
    setBusy(true);
    const start = performance.now();
    try {
      const result =
        relay.enabled && relayEndpoint && relay.policy
          ? await sendViaRelay(
              relayEndpoint,
              relay.policy,
              request,
              abort.signal,
            )
          : await fetch(request.url, {
              ...toFetchRequest(request),
              signal: abort.signal,
              credentials: 'omit',
              redirect: 'error',
            });
      const reader = result.body?.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let size = 0;
      if (reader)
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 2 * 1024 * 1024) {
            await reader.cancel();
            text += '\n[Response truncated at 2 MiB]';
            break;
          }
          text += decoder.decode(part.value, { stream: true });
        }
      text += decoder.decode();
      if (
        abort.signal.aborted ||
        controller.current !== abort ||
        (credentialSession &&
          credentialSession.getResetEpoch() !== auth.resetEpoch)
      )
        return;
      setResponse({
        status: result.status,
        duration: Math.round(performance.now() - start),
        body: text,
        contentType: result.headers.get('content-type') ?? 'text/plain',
        headers: [...result.headers]
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n'),
      });
    } catch (error) {
      if (
        controller.current !== abort ||
        (credentialSession &&
          credentialSession.getResetEpoch() !== auth.resetEpoch)
      )
        return;
      setError(
        error instanceof RelayError
          ? relayErrorText(error.code, t)
          : error instanceof Error && error.name === 'AbortError'
            ? t('playground.requestCancelled')
            : relay.enabled
              ? t('relay.networkFailure')
              : t('playground.browserFailure'),
      );
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) setBusy(false);
    }
  }
  const exampleCode =
    staticSample?.code ??
    (preview.request
      ? generateSnippet(
          redactRequest(
            preview.request,
            credentials,
            (isJsonMediaType(contentType) ||
              isMultipartMediaType(contentType)) &&
              requestMedia
              ? {
                  schema: requestMedia.schema,
                  schemas: api.schemas,
                  openapiVersion: api.openapiVersion,
                }
              : undefined,
          ),
          snippetLanguages.find((item) => item === language) ?? 'cURL',
        )
      : '');
  const snippet = (
    <>
      <div className="snippet-controls">
        <select
          aria-label="Code language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {snippetLanguages.map((item) => (
            <option key={item}>{item}</option>
          ))}
          {(operation.codeSamples ?? []).map((sample) => (
            <option
              key={`${sample.plugin}:${sample.id}`}
              value={`plugin:${sample.plugin}:${sample.id}`}
            >
              {sample.label} (build-time)
            </option>
          ))}
        </select>
        <span>{staticSample ? 'Build-time example' : 'Example'}</span>
        <CopyButton
          text={exampleCode}
          label="Copy request example"
          disabled={!exampleCode}
        />
      </div>
      {staticSample && (
        <p className="static-sample-notice">
          Generated when these docs were built. Playground inputs do not change
          this example.
        </p>
      )}
      {staticSample || preview.request ? (
        <CodeBlock
          code={exampleCode}
          language={staticSample?.language ?? language}
        />
      ) : (
        <p className="preview-error">{preview.error}</p>
      )}
    </>
  );
  if (previewOnly)
    return (
      <aside className="explorer request-example" aria-label="Request example">
        <div className="explorer-header">
          <Icon name="terminal" size={15} />
          Request example
          <button
            type="button"
            className="try-now"
            onClick={onOpen}
            aria-haspopup="dialog"
          >
            {t('playground.try')} <Icon name="arrow" size={14} />
          </button>
        </div>
        {preview.request || operation.codeSamples?.length ? (
          snippet
        ) : (
          <p className="preview-hint">
            Open the playground to configure this request.
          </p>
        )}
      </aside>
    );
  return (
    <aside
      className="explorer playground-workspace"
      aria-label={t('playground.label')}
    >
      <header className="playground-heading">
        <RequestUrlBar
          mockOnly={mockOnly}
          method={operation.method}
          url={requestTarget}
          busy={busy}
          disabled={
            (relay.enabled && !relay.policy) ||
            !!bodyFormError ||
            (isMultipartMediaType(contentType) && !!preview.error)
          }
          onSend={() => {
            void execute();
          }}
          onCancel={() => controller.current?.abort()}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={t('playground.close')}
          onClick={onClose}
          data-close-playground
          autoFocus
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="playground-panels" ref={panels}>
        <section
          id="playground-request-inputs"
          className="playground-inputs"
          aria-label={t('playground.requestConfig')}
        >
          <div className="playground-intro">
            <h2>{operation.summary}</h2>
            <p>{operation.description || t('playground.intro')}</p>
          </div>
          <div className="request-fields">
            {!mockOnly && relayEndpoint && (
              <RelayControls
                relay={relay}
                busy={busy}
                onChange={(enabled) => {
                  controller.current?.abort();
                  controller.current = null;
                  setBusy(false);
                  setError('');
                  setResponse(undefined);
                  relay.select(enabled);
                }}
              />
            )}
            {authNames.length > 0 && (
              <details className="auth-fields request-form-section" open>
                <summary>{t('api.authorization')}</summary>
                {!mockOnly && credentialSession && (
                  <div className="credential-memory-controls">
                    <label className="body-checkbox">
                      <input
                        type="checkbox"
                        checked={auth.remembered}
                        disabled={!authScope.group}
                        onChange={(event) =>
                          auth.remember(event.target.checked)
                        }
                      />
                      <span>{t('auth.remember')}</span>
                    </label>
                    {credentialSession.hasRemembered() && (
                      <button
                        type="button"
                        className="auth-action"
                        onClick={(event) => {
                          const fields =
                            event.currentTarget.closest('.auth-fields');
                          auth.clearAll();
                          requestAnimationFrame(() => {
                            if (fields?.isConnected)
                              fields
                                .querySelector<HTMLInputElement>(
                                  '.auth-field input',
                                )
                                ?.focus();
                          });
                        }}
                      >
                        {t('auth.clearAll')}
                      </button>
                    )}
                    {auth.notice.text && (
                      <p role={auth.notice.error ? 'alert' : 'status'}>
                        {auth.notice.text}
                      </p>
                    )}
                  </div>
                )}
                {authNames.map((name) => (
                  <AuthField
                    key={JSON.stringify([
                      server,
                      name,
                      auth.resetEpoch,
                      !!credentialSession,
                      authScope.keys.get(name),
                    ])}
                    name={name}
                    mockOnly={mockOnly}
                    required={
                      authNames.length === 1 &&
                      !operation.security.some(
                        (alternative) => Object.keys(alternative).length === 0,
                      )
                    }
                    scheme={api.securitySchemes[name]}
                    credential={credentials[name] ?? ''}
                    credentialExpiresAt={auth.entries[name]?.expiresAt}
                    onChange={(value, expiresAt) =>
                      auth.change(name, value, expiresAt)
                    }
                    scopes={
                      operation.security.find((alternative) =>
                        Object.hasOwn(alternative, name),
                      )?.[name] ?? []
                    }
                    client={oauthClients?.[name]}
                    server={server}
                    redirectUri={
                      origin ? `${origin}${basePath}/oauth/callback/` : ''
                    }
                  />
                ))}
              </details>
            )}
            {operation.parameters.some(
              (parameter) =>
                parameter.in !== 'query' && parameter.in !== 'header',
            ) && (
              <details className="request-form-section" open>
                <summary>Path parameters</summary>
                {operation.parameters
                  .filter(
                    (parameter) =>
                      parameter.in !== 'query' && parameter.in !== 'header',
                  )
                  .map((parameter) => {
                    const key = `${parameter.in}:${parameter.name}`;
                    return (
                      <ParameterInput
                        key={key}
                        compact
                        parameter={parameter}
                        value={parameters[key] ?? ''}
                        presence={parameterPresence[key]}
                        allowEmpty={emptyParameters.has(key)}
                        qualified={qualifiedParameterNames.has(parameter.name)}
                        onChange={(value) =>
                          setParameters((previous) => ({
                            ...previous,
                            [key]: value,
                          }))
                        }
                        onPresence={(value) =>
                          setParameterPresence((previous) => {
                            const next = { ...previous };
                            if (value === undefined) delete next[key];
                            else next[key] = value;
                            return next;
                          })
                        }
                      />
                    );
                  })}
              </details>
            )}
            {(['header', 'query'] as const).map((location) => (
              <ParameterForm
                key={JSON.stringify([location, server])}
                location={location}
                declared={operation.parameters.filter(
                  (parameter) =>
                    parameter.in === location &&
                    !(
                      location === 'header' &&
                      /^(accept|content-type|authorization)$/i.test(
                        parameter.name,
                      )
                    ),
                )}
                removed={removedParameters}
                values={parameters}
                presence={parameterPresence}
                empty={emptyParameters}
                qualified={qualifiedParameterNames}
                rows={additionalParameters.filter((row) => row.in === location)}
                onValue={(key, value) =>
                  setParameters((previous) => ({ ...previous, [key]: value }))
                }
                onPresence={(key, value) =>
                  setParameterPresence((previous) => {
                    const next = { ...previous };
                    if (value === undefined) delete next[key];
                    else next[key] = value;
                    return next;
                  })
                }
                onRemoveDeclared={(key) => {
                  setRemovedParameters(
                    (previous) => new Set([...previous, key]),
                  );
                  setParameterPresence((previous) => ({
                    ...previous,
                    [key]: false,
                  }));
                }}
                onRestore={() => {
                  setRemovedParameters(
                    (previous) =>
                      new Set(
                        [...previous].filter(
                          (key) => !key.startsWith(location + ':'),
                        ),
                      ),
                  );
                  setParameterPresence((previous) => {
                    const next = { ...previous };
                    for (const key of removedParameters)
                      if (key.startsWith(location + ':')) delete next[key];
                    return next;
                  });
                }}
                onEdit={(id, patch) =>
                  setParameterDrafts((previous) =>
                    editParameterDraft(previous, id, patch),
                  )
                }
                onRemove={(id) =>
                  setParameterDrafts((previous) => ({
                    ...previous,
                    rows: previous.rows.filter((row) => row.id !== id),
                  }))
                }
              />
            ))}
            {operation.requestBody && (
              <>
                {isMultipartMediaType(contentType) && requestMedia ? (
                  <MultipartBodyEditor
                    key={JSON.stringify([contentType, bodyRevision])}
                    body={body}
                    media={requestMedia}
                    schemas={api.schemas}
                    legacy={api.openapiVersion?.startsWith('3.0') ?? false}
                    files={files}
                    partHeaders={partHeaders}
                    onHeaders={(value) => {
                      setRequestExample('');
                      setPartHeaders(value);
                    }}
                    onFiles={(value) => {
                      setRequestExample('');
                      setFiles(value);
                    }}
                    onChange={(value) => {
                      setRequestExample('');
                      setBody(value);
                    }}
                    onError={setBodyFormError}
                  />
                ) : isFormMediaType(contentType) && requestMedia ? (
                  <FormBodyEditor
                    key={JSON.stringify([contentType, bodyRevision])}
                    body={body}
                    format={bodyFormat}
                    media={requestMedia}
                    schemas={api.schemas}
                    openapiVersion={api.openapiVersion}
                    onError={setBodyFormError}
                    onChange={(value, format) => {
                      setRequestExample('');
                      setBody(value);
                      setBodyFormat(format);
                    }}
                  />
                ) : isJsonMediaType(contentType) ? (
                  <BodyEditor
                    key={JSON.stringify([contentType, bodyRevision])}
                    body={body}
                    schema={requestMedia?.schema ?? {}}
                    schemas={api.schemas}
                    legacy={api.openapiVersion?.startsWith('3.0') ?? false}
                    onError={setBodyFormError}
                    onChange={(value) => {
                      setRequestExample('');
                      setBody(value);
                    }}
                  />
                ) : (
                  <label>
                    Request body
                    <textarea
                      aria-label="Request body"
                      value={body}
                      spellCheck={false}
                      rows={8}
                      onChange={(event) => {
                        setRequestExample('');
                        setBody(event.target.value);
                      }}
                    />
                  </label>
                )}
              </>
            )}
            <details className="request-form-section request-settings">
              <summary>Request settings</summary>
              <div className="request-settings-fields">
                {operation.requestBody && (
                  <>
                    <label hidden={mediaTypes.length === 1}>
                      Content type
                      <select
                        value={contentType}
                        onChange={(event) => {
                          setContentType(event.target.value);
                          const media =
                            operation.requestBody?.content[event.target.value];
                          const choices = media
                            ? exampleChoices(media, api.schemas)
                            : [];
                          setRequestExample(choices[0]?.id ?? '');
                          setBodyFormat(
                            bodyInputFormat(
                              event.target.value,
                              choices[0]?.value,
                            ),
                          );
                          setBodyRevision((current) => current + 1);
                          setBodyFormError('');
                          setFiles({});
                          setPartHeaders({});
                          setBody(
                            choices.length
                              ? exampleBody(
                                  choices[0]!.value,
                                  event.target.value,
                                  media,
                                  api,
                                )
                              : '',
                          );
                        }}
                      >
                        {mediaTypes.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </label>
                    {requestChoices.length > 0 &&
                      (requestChoices.length > 1 ||
                        requestChoices[0]!.id.startsWith('named:') ||
                        !requestExample) && (
                        <label>
                          Request example
                          <select
                            value={requestExample}
                            onChange={(event) => {
                              const choice = requestChoices.find(
                                (item) => item.id === event.target.value,
                              );
                              if (choice) {
                                setRequestExample(choice.id);
                                setBodyFormat(
                                  bodyInputFormat(contentType, choice.value),
                                );
                                setBodyRevision((current) => current + 1);
                                setBodyFormError('');
                                setFiles({});
                                setPartHeaders({});
                                setBody(
                                  exampleBody(
                                    choice.value,
                                    contentType,
                                    requestMedia,
                                    api,
                                  ),
                                );
                              }
                            }}
                          >
                            {!requestExample && (
                              <option value="">Custom request</option>
                            )}
                            {requestChoices.map((choice) => (
                              <option key={choice.id} value={choice.id}>
                                {choice.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    {requestMedia && hasExternalExamples(requestMedia) && (
                      <p className="example-note">
                        External examples are not loaded. Local values are shown
                        here.
                      </p>
                    )}
                  </>
                )}
                {responseTypes.length > 1 && (
                  <label>
                    Requested response format
                    <select
                      value={accept}
                      onChange={(event) => setAccept(event.target.value)}
                    >
                      {responseTypes.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {t('playground.server')}
                  <input
                    aria-label={t('playground.serverLabel')}
                    value={server}
                    onChange={(event) => {
                      setServer(event.target.value);
                      auth.clearLocal();
                      setParameterDrafts(createParameterDrafts());
                      controller.current?.abort();
                      controller.current = null;
                      setBusy(false);
                      setResponse(undefined);
                      setError('');
                      if (isMultipartMediaType(contentType)) {
                        setFiles({});
                        setPartHeaders({});
                        setBodyRevision((current) => current + 1);
                      }
                    }}
                    spellCheck={false}
                  />
                </label>
                {!operation.servers.length && (
                  <p className="subtle">{t('playground.noServer')}</p>
                )}
              </div>
            </details>
          </div>
          <details className="playground-request-example">
            <summary>Request example</summary>
            {snippet}
          </details>
          <MockResponseControls
            api={api}
            operation={operation}
            busy={busy}
            onGenerate={showMockResponse}
          />
          {error && (
            <p role="alert" className="request-error">
              {error}
            </p>
          )}
          <p className="request-note">
            {mockOnly
              ? t('playground.mockNote')
              : relay.enabled
                ? 'Requests are sent through the documentation server. It enforces its configured destination policy and does not retry requests.'
                : 'Requests are sent directly from your browser.'}
          </p>
        </section>
        <PanelResizeHandle
          target={panels}
          property="--request-panel-width"
          initial={740}
          min={280}
          max={1100}
          label={t('layout.playground')}
          controls="playground-request-inputs"
          storageKey={basePath}
          className="playground-resize"
        />
        <section
          className="playground-output"
          aria-label={t('response.region')}
        >
          <div className="response-content">
            {response ? (
              <>
                <div className="response-meta">
                  <span
                    className={
                      response.status < 400
                        ? 'response-success'
                        : 'response-failed'
                    }
                  >
                    {response.status}
                  </span>
                  {response.mock ? (
                    <span className="mock-response-badge" role="status">
                      Mock response · {response.mock.source} · documented{' '}
                      {response.mock.documentedStatus}
                    </span>
                  ) : (
                    <span>{response.duration} ms</span>
                  )}
                </div>
                <Suspense
                  fallback={<p role="status">{t('response.loading')}</p>}
                >
                  <ResponseEditor
                    body={response.body}
                    contentType={response.contentType}
                  />
                </Suspense>
                <details>
                  <summary>{t('response.headers')}</summary>
                  <pre>{response.headers}</pre>
                </details>
              </>
            ) : (
              <div className="response-empty">
                <Icon name="terminal" size={30} />
                <h3>{t('response.empty')}</h3>
                <p>{t('response.emptyHelp')}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
