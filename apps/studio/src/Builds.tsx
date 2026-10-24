import { useLayoutEffect, useRef, useState } from 'react';
import type { Project } from '@davidniessen/doctopus-domain';
import { StudioApiError } from './api.js';
import type { StudioApi } from './api.js';
import { BuildSourceForm } from './BuildSourceForm.js';
import type { SourceApprovalInput } from './BuildSourceForm.js';
import { useBuildData } from './use-build-data.js';
import './builds.css';

export interface BuildAction {
  projectId: string;
  kind: 'approve' | 'enqueue' | 'cancel' | 'revoke';
  path: string;
  payload: unknown;
  description: string;
}
const states = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const errors = {
  build_failed: 'Build failed',
  worker_lost: 'Worker lost',
  source_changed: 'Source changed',
  deadline_exceeded: 'Deadline exceeded',
  source_revoked: 'Source approval revoked',
  cancelled: 'Cancelled',
};
const when = (value: string) => (
  <time dateTime={value}>{new Date(value).toLocaleString()}</time>
);

export default function Builds({
  project,
  api,
  pending,
  onPending,
  onReviewArtifact,
}: {
  project: Project;
  api: StudioApi;
  pending: BuildAction | undefined;
  onPending: (action: BuildAction | undefined) => void;
  onReviewArtifact: (artifactId: string, signal: AbortSignal) => Promise<void>;
}) {
  const [sourceCursors, setSourceCursors] = useState<(string | undefined)[]>([
      undefined,
    ]),
    [sourcePage, setSourcePage] = useState(0);
  const [jobCursors, setJobCursors] = useState<(string | undefined)[]>([
      undefined,
    ]),
    [jobPage, setJobPage] = useState(0);
  const [includeRevoked, setIncludeRevoked] = useState(false),
    [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [mutationError, setMutationError] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  const sending = useRef(false);
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const data = useBuildData(
    project.id,
    api,
    sourceCursors[sourcePage],
    jobCursors[jobPage],
    includeRevoked,
  );
  const capabilities = data.capabilities;
  const blocked = busy || data.loading || !!data.error || !!pending;
  const base = '/api/projects/' + encodeURIComponent(project.id);
  const source = data.sources.items.find(
    (source) => source.id === selected && !source.revokedAt,
  );
  const canRetry =
    pending &&
    pending.projectId === project.id &&
    capabilities &&
    {
      approve: capabilities.approveSource,
      enqueue: capabilities.enqueue,
      cancel: capabilities.cancel,
      revoke: capabilities.revokeSource,
    }[pending.kind];
  async function perform(action: BuildAction) {
    const controller = lifetime.current;
    if (
      !controller ||
      controller.signal.aborted ||
      sending.current ||
      action.projectId !== project.id ||
      (pending && pending !== action)
    )
      return;
    const retry = pending === action;
    sending.current = true;
    onPending(action);
    setBusy(true);
    setMutationError('');
    setMessage('');
    try {
      await api(action.path, 'POST', action.payload, controller.signal);
      if (controller.signal.aborted) return;
      onPending(undefined);
      setMessage(
        {
          approve:
            'Source approved. Prepare this exact approval in the worker registry before building.',
          enqueue: 'Build queued. A configured worker will pick it up.',
          cancel:
            'Build cancelled. Running work stops when ownership is renewed.',
          revoke:
            'Source approval revoked. Its unfinished builds were cancelled.',
        }[action.kind],
      );
      if (action.kind === 'enqueue') {
        setJobCursors([undefined]);
        setJobPage(0);
      }
      if (action.kind === 'approve') {
        setSourceCursors([undefined]);
        setSourcePage(0);
        setIncludeRevoked(false);
      }
      data.refresh();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof StudioApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        !retry
      )
        onPending(undefined);
      setMutationError(
        error instanceof Error
          ? error.message
          : 'The action could not be confirmed.',
      );
      data.refresh();
    } finally {
      sending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function approve(input: SourceApprovalInput) {
    void perform({
      projectId: project.id,
      kind: 'approve',
      path: base + '/build-sources',
      payload: { ...input, idempotencyKey: crypto.randomUUID() },
      description: `Approve source “${input.label}”`,
    });
  }
  async function copyApproval(value: unknown) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setMessage(
        'Source approval copied. Add the local directory in your worker registry.',
      );
    } catch {
      setMutationError(
        'Clipboard unavailable. Select and copy the displayed approval details.',
      );
    }
  }
  return (
    <div className="builds-workspace">
      <div className="build-controls">
        <p>
          Build immutable documentation from reviewed sources. Successful builds
          are ready for a separate publication review.
        </p>
        <button
          type="button"
          className="secondary"
          disabled={data.loading || busy}
          onClick={data.refresh}
        >
          Refresh builds
        </button>
      </div>
      {data.error && (
        <p role="alert" className="error">
          {data.error}
        </p>
      )}
      {mutationError && (
        <p role="alert" className="error">
          {mutationError}
        </p>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {pending && (
        <section
          className="panel pending-build-action"
          aria-label="Pending build action"
        >
          <h2>{busy ? 'Confirming action' : 'Action needs confirmation'}</h2>
          <p>{pending.description}</p>
          <p>
            Retry confirms the original action without creating a duplicate. You
            can review history while the result is uncertain.
          </p>
          <div className="build-controls">
            <button
              type="button"
              className="secondary"
              disabled={busy || data.loading || !!data.error || !canRetry}
              onClick={() => void perform(pending)}
            >
              Retry pending action
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onPending(undefined);
                setMutationError('');
              }}
            >
              Discard retry after reviewing history
            </button>
          </div>
        </section>
      )}
      {capabilities?.enqueue && (
        <section className="panel" aria-labelledby="enqueue-build-heading">
          <h2 id="enqueue-build-heading">Queue a build</h2>
          <p>
            Source must match its approved digest and execution policy. This
            project requires <code>basePath: /docs/{project.slug}</code>.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (source)
                void perform({
                  projectId: project.id,
                  kind: 'enqueue',
                  path: base + '/builds',
                  payload: {
                    sourceId: source.id,
                    idempotencyKey: crypto.randomUUID(),
                  },
                  description: `Queue build from “${source.label}”`,
                });
            }}
          >
            <label>
              Approved source
              <select
                aria-label="Approved source"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                required
              >
                <option value="">Select an approved source</option>
                {data.sources.items.map((source) => (
                  <option
                    value={source.id}
                    key={source.id}
                    disabled={!!source.revokedAt}
                  >
                    {source.label}
                    {source.revokedAt ? ' · revoked' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={blocked || !source}>
              Queue build
            </button>
          </form>
        </section>
      )}
      {capabilities && !capabilities.enqueue && (
        <p className="build-read-only">
          You can review build history. An editor can queue or cancel builds.
        </p>
      )}
      <section className="panel" aria-labelledby="build-history-heading">
        <h2 id="build-history-heading">Build history</h2>
        {data.loading && <p role="status">Loading build status…</p>}
        {!data.jobs.items.length && !data.loading && !data.error ? (
          <p>No builds on this page.</p>
        ) : (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Scrollable build history"
          >
            <table>
              <thead>
                <tr>
                  <th>Build</th>
                  <th>State</th>
                  <th>Attempts</th>
                  <th>Updated</th>
                  <th>Result</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.items.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <code title={job.id}>{job.id.slice(0, 8)}</code>
                      <small title={job.sourceId}>
                        Source {job.sourceId.slice(0, 8)}
                      </small>
                      {job.workerId && <small>{job.workerId}</small>}
                    </td>
                    <td>
                      <span className={`badge build-state-${job.state}`}>
                        {states[job.state]}
                      </span>
                    </td>
                    <td>
                      {job.attempts} / {job.maxAttempts}
                    </td>
                    <td>{when(job.updatedAt)}</td>
                    <td>
                      {job.artifactId ? (
                        <code title={job.artifactId}>
                          {job.artifactId.slice(0, 12)}
                        </code>
                      ) : job.errorCode ? (
                        errors[job.errorCode]
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className="build-row-actions">
                        {capabilities?.cancel &&
                          ['queued', 'running'].includes(job.state) && (
                            <button
                              type="button"
                              disabled={blocked}
                              aria-label={`Cancel build ${job.id.slice(0, 8)}`}
                              onClick={() =>
                                void perform({
                                  projectId: project.id,
                                  kind: 'cancel',
                                  path:
                                    base +
                                    '/builds/' +
                                    encodeURIComponent(job.id) +
                                    '/cancel',
                                  payload: {},
                                  description:
                                    'Cancel build ' + job.id.slice(0, 8),
                                })
                              }
                            >
                              Cancel build
                            </button>
                          )}
                        {capabilities?.publish &&
                          job.state === 'succeeded' &&
                          job.artifactId && (
                            <button
                              type="button"
                              disabled={blocked}
                              aria-label={`Review artifact from build ${job.id.slice(0, 8)}`}
                              onClick={() => {
                                setBusy(true);
                                void onReviewArtifact(
                                  job.artifactId!,
                                  lifetime.current!.signal,
                                )
                                  .catch((error: unknown) => {
                                    if (!lifetime.current?.signal.aborted)
                                      setMutationError(
                                        error instanceof Error
                                          ? error.message
                                          : 'Publication review is unavailable.',
                                      );
                                  })
                                  .finally(() => {
                                    if (!lifetime.current?.signal.aborted)
                                      setBusy(false);
                                  });
                              }}
                            >
                              Review publication
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="build-pagination" aria-label="Build history pages">
          <button
            type="button"
            disabled={data.loading || jobPage === 0}
            onClick={() => setJobPage((page) => page - 1)}
          >
            Newer builds
          </button>
          <span>
            Page {jobPage + 1} · {data.jobs.items.length} shown
          </span>
          <button
            type="button"
            disabled={data.loading || !data.jobs.nextCursor}
            onClick={() => {
              const cursor = data.jobs.nextCursor;
              if (cursor) {
                setJobCursors((values) => [
                  ...values.slice(0, jobPage + 1),
                  cursor,
                ]);
                setJobPage((page) => page + 1);
              }
            }}
          >
            Older builds
          </button>
        </div>
      </section>
      <section className="panel" aria-labelledby="approved-sources-heading">
        <div className="build-source-heading">
          <h2 id="approved-sources-heading">Source approvals</h2>
          <label className="build-checkbox">
            <input
              type="checkbox"
              checked={includeRevoked}
              onChange={(event) => {
                setIncludeRevoked(event.target.checked);
                setSourceCursors([undefined]);
                setSourcePage(0);
                setSelected('');
              }}
            />
            Include revoked sources
          </label>
        </div>
        {!data.sources.items.length && !data.loading && !data.error && (
          <p>
            No source approvals on this page. An operator can approve reviewed
            source metadata and prepare it on a worker.
          </p>
        )}
        {data.sources.items.map((source) => (
          <details className="build-source" key={source.id}>
            <summary>
              <strong>{source.label}</strong>
              <span className="badge">
                {source.revokedAt ? 'Revoked' : 'Approved'}
              </span>
            </summary>
            {source.revision && (
              <p>
                Revision: <code>{source.revision}</code>
              </p>
            )}
            <p>
              Approved {when(source.createdAt)} by {source.approvedBy}
            </p>
            <p>
              {source.snapshot.files} files ·{' '}
              {source.snapshot.bytes.toLocaleString()} bytes
            </p>
            <pre
              tabIndex={0}
              aria-label={`Approval details for ${source.label}`}
            >
              {JSON.stringify(
                {
                  id: source.id,
                  projectId: source.projectId,
                  snapshot: source.snapshot,
                  policy: source.policy,
                },
                null,
                2,
              )}
            </pre>
            <div className="build-controls">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void copyApproval({
                    id: source.id,
                    projectId: source.projectId,
                    snapshot: source.snapshot,
                    policy: source.policy,
                  })
                }
              >
                Copy source approval
              </button>
              {capabilities?.revokeSource && !source.revokedAt && (
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    if (
                      confirm(
                        'Revoke this source approval and cancel its queued and running builds?',
                      )
                    )
                      void perform({
                        projectId: project.id,
                        kind: 'revoke',
                        path:
                          base +
                          '/build-sources/' +
                          encodeURIComponent(source.id) +
                          '/revoke',
                        payload: {},
                        description: `Revoke source “${source.label}”`,
                      });
                  }}
                >
                  Revoke source
                </button>
              )}
            </div>
          </details>
        ))}
        <div className="build-pagination" aria-label="Source approval pages">
          <button
            type="button"
            disabled={data.loading || sourcePage === 0}
            onClick={() => {
              setSourcePage((page) => page - 1);
              setSelected('');
            }}
          >
            Newer sources
          </button>
          <span>
            Page {sourcePage + 1} · {data.sources.items.length} shown
          </span>
          <button
            type="button"
            disabled={data.loading || !data.sources.nextCursor}
            onClick={() => {
              const cursor = data.sources.nextCursor;
              if (cursor) {
                setSourceCursors((values) => [
                  ...values.slice(0, sourcePage + 1),
                  cursor,
                ]);
                setSourcePage((page) => page + 1);
                setSelected('');
              }
            }}
          >
            Older sources
          </button>
        </div>
      </section>
      {capabilities?.approveSource && (
        <BuildSourceForm
          disabled={blocked}
          onApprove={approve}
          onError={setMutationError}
        />
      )}
    </div>
  );
}
