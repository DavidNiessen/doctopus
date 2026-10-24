import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { BuildAction } from './Builds.js';
import { AppearanceControl } from './AppearanceControl.js';
import { NavigationResize } from './NavigationResize.js';
import { createStudioApi } from './api.js';
import { createStudioRequestScope } from './request-scope.js';
import { useProjectCapabilities } from './use-project-capabilities.js';
import { createRoot } from 'react-dom/client';
import type { Project, Publication } from '@davidniessen/doctopus-domain';
import '../../shared/design-tokens.css';
import './styles.css';
import './island-layout.css';
import '../../shared/scrollbars.css';
import '../../shared/accessibility.css';
const Builds = lazy(() => import('./Builds.js'));
const navigationIcons: Record<string, string> = {
  Overview: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  Builds: 'm5 7 4 5-4 5m8 0h6',
  Publications: 'M5 12h14m-6-6 6 6-6 6',
  'Access control': 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  'Audit log': 'M4 6h16M4 12h16M4 18h16',
};
function WorkspaceMark() {
  return (
    <img
      src="/admin/assets/doctopus-mascot.webp"
      alt=""
      width={40}
      height={40}
      decoding="async"
    />
  );
}

function Studio() {
  const layout = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  useLayoutEffect(() => {
    const chrome = header.current;
    const workspace = layout.current;
    if (!connected || !chrome || !workspace) return;
    const measure = () => {
      workspace.style.setProperty(
        '--studio-header-height',
        `${chrome.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, [connected]);
  const [signingOut, setSigningOut] = useState(false);
  const [requestEpoch, setRequestEpoch] = useState(0);
  const connection = useRef<AbortController | null>(null);
  const probe = useRef<AbortController | null>(null);
  const logoutRequest = useRef<AbortController | null>(null);
  const [buildsAvailable, setBuildsAvailable] = useState(false);
  const [pendingBuildActions, setPendingBuildActions] = useState<
    Record<string, BuildAction | undefined>
  >({});
  const [artifactDraft, setArtifactDraft] = useState('');
  const [oidc, setOidc] = useState(false);
  const [operator, setOperator] = useState(false);
  const [subject, setSubject] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('');
  const selectedProject = useRef(selected);
  selectedProject.current = selected;
  const [tab, setTab] = useState('Overview');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [issuedToken, setIssuedToken] = useState('');
  const project = projects.find((item) => item.id === selected);
  const transport = useMemo(() => createStudioApi(token), [token]);
  function clearWorkspace() {
    setToken('');
    setConnected(false);
    setBuildsAvailable(false);
    setPendingBuildActions({});
    setArtifactDraft('');
    setProjects([]);
    setSelected('');
    setSubject('');
    setOperator(false);
    setPublications([]);
    setAudit([]);
    setIssuedToken('');
    setMessage('');
  }
  const scope = useMemo(
    () =>
      createStudioRequestScope(transport, () => {
        clearWorkspace();
        setError('Your session has expired. Sign in again to continue.');
      }),
    [transport, connected, selected, tab, requestEpoch],
  );
  const api = scope.api;
  const [publicationsScope, setPublicationsScope] = useState<ReturnType<
    typeof createStudioRequestScope
  > | null>(null);
  const access = useProjectCapabilities(connected ? selected : '', api);
  const running = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    setBusy(false);
    setPublications([]);
    setPublicationsScope(null);
    setAudit([]);
    setIssuedToken('');
    return scope.cancel;
  }, [scope]);
  useLayoutEffect(() => {
    setArtifactDraft('');
  }, [selected]);
  useEffect(
    () => () => {
      probe.current?.abort();
      connection.current?.abort();
      logoutRequest.current?.abort();
    },
    [],
  );
  function navigate(next: string) {
    setError('');
    setMessage('');
    setTab(next);
  }
  function chooseProject(id: string) {
    setError('');
    setMessage('');
    setSelected(id);
  }
  async function work(task: () => Promise<void>) {
    if (scope.signal.aborted || running.current === scope) return;
    running.current = scope;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
    } catch (error) {
      if (!scope.signal.aborted)
        setError(
          error instanceof Error ? error.message : 'The operation failed',
        );
    } finally {
      if (running.current === scope) running.current = null;
      if (!scope.signal.aborted) setBusy(false);
    }
  }
  async function refresh() {
    const data = await api<Project[]>('/api/projects');
    setProjects(data);
    if (selected && !data.some((item) => item.id === selected)) setSelected('');
  }
  async function loadPublications() {
    const items = await api<Publication[]>(
      `/api/projects/${selected}/publications`,
    );
    setPublications(items);
    setPublicationsScope(scope);
  }
  async function connect() {
    if (connection.current || logoutRequest.current) return;
    probe.current?.abort();
    const controller = new AbortController();
    connection.current = controller;
    const signal = controller.signal;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const me = await transport<{
        subject: string | null;
        oidc: boolean;
        builds?: boolean;
        operator?: boolean;
      }>('/api/me', 'GET', undefined, signal);
      signal.throwIfAborted();
      setOidc(me.oidc);
      if (!me.subject)
        throw new Error(
          'Sign in with your identity provider or enter an operator/project token.',
        );
      if (token) await transport('/auth/token', 'POST', undefined, signal);
      signal.throwIfAborted();
      const data = await createStudioApi('')<Project[]>(
        '/api/projects',
        'GET',
        undefined,
        signal,
      );
      signal.throwIfAborted();
      setSubject(me.subject);
      setOperator(me.operator === true);
      setBuildsAvailable(me.builds === true);
      setProjects(data);
      setSelected(data[0]?.id ?? '');
      setToken('');
      setConnected(true);
      setTab('Overview');
    } catch (error) {
      if (!signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : 'Sign-in could not be confirmed.',
        );
    } finally {
      if (connection.current === controller) connection.current = null;
      if (!signal.aborted) setBusy(false);
    }
  }
  async function signOut() {
    if (logoutRequest.current) return;
    scope.cancel();
    probe.current?.abort();
    connection.current?.abort();
    const controller = new AbortController();
    logoutRequest.current = controller;
    setSigningOut(true);
    setIssuedToken('');
    setError('');
    setMessage('');
    try {
      await transport('/auth/logout', 'POST', undefined, controller.signal);
      controller.signal.throwIfAborted();
      clearWorkspace();
    } catch {
      if (!controller.signal.aborted)
        setError('Server sign-out could not be confirmed. Try Sign out again.');
    } finally {
      if (logoutRequest.current === controller) logoutRequest.current = null;
      if (!controller.signal.aborted) {
        setSigningOut(false);
        setRequestEpoch((value) => value + 1);
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    probe.current = controller;
    void transport<{ subject: string | null; oidc: boolean }>(
      '/api/me',
      'GET',
      undefined,
      controller.signal,
    )
      .then((me) => {
        if (controller.signal.aborted) return;
        setOidc(me.oidc);
        if (me.subject) void connect();
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('The management API is unavailable.');
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (
      !connected ||
      !selected ||
      (tab === 'Publications' && !access.capabilities?.publish) ||
      (tab === 'Audit log' && !access.capabilities?.readAudit) ||
      !['Publications', 'Audit log'].includes(tab)
    )
      return;
    void work(async () => {
      if (tab === 'Publications') await loadPublications();
      if (tab === 'Audit log')
        setAudit(
          await api<Record<string, unknown>[]>(
            `/api/projects/${selected}/audit`,
          ),
        );
    });
  }, [scope, access.capabilities]);
  useEffect(() => {
    if (!selected || !access.denied) return;
    setProjects((previous) => previous.filter((item) => item.id !== selected));
    setSelected('');
    setTab('Overview');
    setError(
      'Project access changed. Refresh projects to see your current access.',
    );
  }, [selected, access.denied]);
  useEffect(() => {
    if (!access.capabilities) return;
    const allowed = {
      Publications: access.capabilities.publish,
      'Access control': access.capabilities.manageAccess,
      'Audit log': access.capabilities.readAudit,
    }[tab];
    if (allowed === false) {
      setTab('Overview');
      setMessage(
        'Your permissions changed. Available actions have been updated.',
      );
    }
  }, [access.capabilities, tab]);
  async function publish(artifactId: string) {
    if (!project) return;
    await api(`/api/projects/${project.id}/artifacts`, 'POST', { artifactId });
    await api(`/api/projects/${project.id}/publications`, 'POST', {
      artifactId,
      expectedPublicationId: project.activePublicationId,
      idempotencyKey: crypto.randomUUID(),
    });
    await refresh();
    await loadPublications();
    setMessage(
      'Publication activated. The prior release remains available for rollback.',
    );
  }
  return (
    <div className="studio">
      <header ref={header}>
        <a className="studio-brand" href="/admin/">
          <span>
            <WorkspaceMark />
          </span>
          Doctopus <small>Studio</small>
        </a>
        <span className="self-hosted">Your docs. In good hands.</span>
        <div className="studio-header-actions">
          <AppearanceControl />
          {connected && (
            <button
              type="button"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </div>
      </header>
      {!connected ? (
        <main className="login">
          <div className="login-mark">
            <WorkspaceMark />
          </div>
          <p className="eyebrow">YOUR DOCUMENTATION, YOUR INFRASTRUCTURE</p>
          <h1>Welcome to your workspace</h1>
          <p>Publish beautiful documentation. Keep complete control.</p>
          {oidc && (
            <a className="primary" href="/auth/login">
              Continue with single sign-on →
            </a>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <label>
              Operator or project token
              <input
                type="password"
                disabled={busy}
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Enter your access token"
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              Connect to workspace →
            </button>
          </form>
          <small>
            Tokens are exchanged for an expiring HttpOnly session. They are
            never saved in browser storage.
          </small>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </main>
      ) : (
        <div className="studio-layout" inert={signingOut} ref={layout}>
          <aside id="studio-navigation">
            <div className="workspace-label">Workspace</div>
            <label className="project-picker">
              Current project
              <select
                aria-label="Current project"
                value={selected}
                onChange={(event) => chooseProject(event.target.value)}
              >
                <option value="">Select a project</option>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="refresh-projects"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await refresh();
                  access.refresh();
                  setMessage('Projects refreshed.');
                })
              }
            >
              Refresh projects
            </button>
            <nav>
              {[
                'Overview',
                ...(buildsAvailable ? ['Builds'] : []),
                ...(operator || access.capabilities?.publish
                  ? ['Publications']
                  : []),
                ...(operator || access.capabilities?.manageAccess
                  ? ['Access control']
                  : []),
                ...(operator || access.capabilities?.readAudit
                  ? ['Audit log']
                  : []),
              ].map((name) => (
                <button
                  type="button"
                  key={name}
                  className={tab === name ? 'selected' : ''}
                  aria-current={tab === name ? 'page' : undefined}
                  aria-label={name}
                  onClick={() => navigate(name)}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.65"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={navigationIcons[name]} />
                  </svg>
                  {name}
                </button>
              ))}
            </nav>
            <div className="identity">
              <span className="avatar">
                {subject.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>Connected identity</strong>
                <small>{subject}</small>
              </div>
            </div>
          </aside>
          <div
            className="studio-navigation-resize-controls"
            role="region"
            aria-label="Navigation layout"
          >
            <NavigationResize target={layout} />
          </div>
          <main className="workspace-main" key={`${selected}:${tab}`}>
            <div className="workspace-heading">
              <div>
                <p className="eyebrow">
                  Workspace / {project?.name ?? 'Projects'}
                </p>
                <h1>{tab}</h1>
                <p>
                  {
                    {
                      Overview:
                        'Your documentation, from source to production.',
                      Builds:
                        'Review approved sources, follow build progress, and prepare a release.',
                      Publications:
                        'Publish confidently. Roll back without losing history.',
                      'Access control':
                        'Give the right people the right level of access.',
                      'Audit log':
                        'A clear record of important workspace changes.',
                    }[tab]
                  }
                </p>
              </div>
              {project?.activePublicationId && (
                <a
                  className="secondary"
                  href={`/docs/${project.slug}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View documentation ↗
                </a>
              )}
            </div>
            {access.loading && (
              <p role="status">Loading project permissions…</p>
            )}
            {access.error && !access.denied && (
              <div className="project-permissions-error">
                <p role="alert" className="error">
                  {access.error}
                </p>
                <button type="button" onClick={access.refresh}>
                  Retry permissions
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="success">
                {message}
              </p>
            )}
            {!project &&
              ['Publications', 'Access control', 'Audit log'].includes(tab) && (
                <section className="panel">
                  <p>Select a project to view its available actions.</p>
                </section>
              )}
            {tab === 'Overview' && (
              <>
                <div className="stats-grid">
                  <div className="stat-card">
                    <span>Total projects</span>
                    <strong>{projects.length}</strong>
                    <small>Managed in this workspace</small>
                  </div>
                  <div className="stat-card">
                    <span>Publication</span>
                    <strong>
                      {project?.activePublicationId ? 'Live' : 'Unpublished'}
                    </strong>
                    <small>
                      {project
                        ? `/${project.slug}`
                        : 'Choose a project to get started'}
                    </small>
                  </div>
                  <div className="stat-card">
                    <span>Visibility</span>
                    <strong>{project?.visibility ?? '—'}</strong>
                    <small>Authorization covers every asset</small>
                  </div>
                </div>
                {operator && (
                  <section className="panel">
                    <h2>Create a project</h2>
                    <p>
                      Configure a documentation space. Project creation requires
                      operator access.
                    </p>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void work(async () => {
                          const created = await api<Project>(
                            '/api/projects',
                            'POST',
                            {
                              name: String(form.get('name')),
                              slug: String(form.get('slug')),
                              visibility: String(form.get('visibility')),
                            },
                          );
                          await refresh();
                          setSelected(created.id);
                          setMessage(
                            'Project created. Build your publication with basePath /docs/' +
                              created.slug,
                          );
                        });
                      }}
                    >
                      <div className="form-grid">
                        <label>
                          Project name
                          <input
                            name="name"
                            required
                            maxLength={100}
                            placeholder="Platform API"
                          />
                        </label>
                        <label>
                          URL slug
                          <input
                            name="slug"
                            required
                            pattern="[a-z][a-z0-9-]{0,62}"
                            placeholder="platform"
                          />
                        </label>
                        <label>
                          Visibility
                          <select name="visibility">
                            <option value="private">Private</option>
                            <option value="public">Public</option>
                          </select>
                        </label>
                      </div>
                      <button className="primary" disabled={busy}>
                        Create project →
                      </button>
                    </form>
                  </section>
                )}
                <section className="panel getting-started">
                  <h2>A simple path to great documentation</h2>
                  <ol>
                    <li>
                      <span>1</span>
                      <div>
                        <strong>Connect your OpenAPI specification</strong>
                        <p>
                          Use the CLI to import YAML or JSON and add your
                          guides.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>2</span>
                      <div>
                        <strong>Build and stage your publication</strong>
                        <p>
                          Verify the immutable artifact and stage it in your
                          configured storage.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>3</span>
                      <div>
                        <strong>Publish with confidence</strong>
                        <p>
                          Activate your release. Keep every previous version for
                          safe rollback.
                        </p>
                      </div>
                    </li>
                  </ol>
                </section>
              </>
            )}
            {tab === 'Builds' &&
              buildsAvailable &&
              (project ? (
                <Suspense fallback={<p role="status">Loading builds…</p>}>
                  <Builds
                    key={project.id}
                    project={project}
                    api={api}
                    pending={pendingBuildActions[project.id]}
                    onPending={(action) =>
                      setPendingBuildActions((previous) => {
                        const next = { ...previous };
                        if (action) next[project.id] = action;
                        else delete next[project.id];
                        return next;
                      })
                    }
                    onReviewArtifact={async (artifactId, signal) => {
                      const data = await api<Project[]>(
                        '/api/projects',
                        'GET',
                        undefined,
                        signal,
                      );
                      if (
                        signal.aborted ||
                        selectedProject.current !== project.id
                      )
                        return;
                      setProjects(data);
                      setArtifactDraft(artifactId);
                      setTab('Publications');
                    }}
                  />
                </Suspense>
              ) : (
                <section className="panel">
                  <p>
                    Select a project to review its build sources and history.
                  </p>
                </section>
              ))}
            {tab === 'Publications' && access.capabilities?.publish && (
              <>
                <section className="panel">
                  <h2>Activate a staged artifact</h2>
                  <p>
                    Build with{' '}
                    <code>basePath: /docs/{project?.slug ?? 'project'}</code>{' '}
                    and stage the output before activation.
                  </p>
                  {publicationsScope !== scope &&
                    (error ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void work(loadPublications)}
                      >
                        Retry publication history
                      </button>
                    ) : (
                      <p role="status">Loading publication history…</p>
                    ))}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void work(() => publish(String(form.get('artifact'))));
                    }}
                  >
                    <label>
                      Artifact SHA-256
                      <input
                        name="artifact"
                        value={artifactDraft}
                        disabled={
                          busy || !project || publicationsScope !== scope
                        }
                        onChange={(event) =>
                          setArtifactDraft(event.target.value)
                        }
                        required
                        pattern="[a-f0-9]{64}"
                        placeholder="64-character verified artifact id"
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={busy || !project || publicationsScope !== scope}
                    >
                      Verify and publish →
                    </button>
                  </form>
                </section>
                <section className="panel">
                  <h2>Publication history</h2>
                  {!publications.length ? (
                    <p>No publications yet. Your first release starts here.</p>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Publication</th>
                            <th>Created</th>
                            <th>Status</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {publications.map((publication) => (
                            <tr key={publication.id}>
                              <td>
                                <code title={publication.artifactId}>
                                  {publication.artifactId.slice(0, 12)}
                                </code>
                                <small>{publication.subject}</small>
                              </td>
                              <td>
                                {new Date(
                                  publication.createdAt,
                                ).toLocaleString()}
                              </td>
                              <td>
                                <span
                                  className={
                                    publication.id ===
                                    project?.activePublicationId
                                      ? 'badge live'
                                      : 'badge'
                                  }
                                >
                                  {publication.id ===
                                  project?.activePublicationId
                                    ? 'Live'
                                    : 'Retained'}
                                </span>
                              </td>
                              <td>
                                {publication.id !==
                                  project?.activePublicationId && (
                                  <button
                                    disabled={busy}
                                    type="button"
                                    onClick={() => {
                                      if (
                                        confirm(
                                          'Activate this previous artifact as a new publication?',
                                        )
                                      )
                                        void work(() =>
                                          publish(publication.artifactId),
                                        );
                                    }}
                                  >
                                    Roll back ↗
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
            {tab === 'Access control' && access.capabilities?.manageAccess && (
              <>
                <section className="panel">
                  <h2>Manage identity access</h2>
                  <p>
                    Use the immutable identity provider issuer + subject. Set
                    “Remove access” to revoke a role immediately.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void work(async () => {
                        await api(`/api/projects/${selected}/roles`, 'PUT', {
                          subject: String(form.get('subject')),
                          role: form.get('role') || null,
                        });
                        setMessage(
                          'Role updated. Permission changes apply to subsequent requests.',
                        );
                      });
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        Identity subject
                        <input
                          name="subject"
                          required
                          placeholder="https://idp.example.com|subject-id"
                        />
                      </label>
                      <label>
                        Role
                        <select name="role">
                          <option>viewer</option>
                          <option>editor</option>
                          <option>publisher</option>
                          <option>admin</option>
                          <option value="">Remove access</option>
                        </select>
                      </label>
                    </div>
                    <button className="primary" disabled={busy || !project}>
                      Update access
                    </button>
                  </form>
                </section>
                <section className="panel">
                  <h2>Create a scoped token</h2>
                  <p>
                    Grant CI or integrations the smallest required permission.
                    Tokens expire within 90 days.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void work(async () => {
                        const result = await api<{ token: string; id: string }>(
                          `/api/projects/${selected}/tokens`,
                          'POST',
                          {
                            label: String(form.get('label')),
                            role: String(form.get('role')),
                            expiresInDays: Number(form.get('days')),
                          },
                        );
                        setIssuedToken(result.token);
                        setMessage(
                          'Token id: ' +
                            result.id +
                            '. Copy the token now; it cannot be retrieved later.',
                        );
                      });
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        Label
                        <input
                          name="label"
                          required
                          placeholder="Deploy pipeline"
                        />
                      </label>
                      <label>
                        Role
                        <select name="role">
                          <option>publisher</option>
                          <option>viewer</option>
                          <option>editor</option>
                          <option>admin</option>
                        </select>
                      </label>
                      <label>
                        Expiry (days)
                        <input
                          name="days"
                          type="number"
                          min={1}
                          max={90}
                          defaultValue={30}
                          required
                        />
                      </label>
                    </div>
                    <button className="primary" disabled={busy || !project}>
                      Create token
                    </button>
                  </form>
                  {issuedToken && (
                    <label className="issued-token">
                      Token (shown once)
                      <input
                        readOnly
                        type="password"
                        value={issuedToken}
                        onFocus={(event) => event.target.select()}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(issuedToken)
                            .then(() => {
                              if (!scope.signal.aborted)
                                setMessage('Token copied. Store it securely.');
                            })
                            .catch(() => {
                              if (!scope.signal.aborted)
                                setError(
                                  'Clipboard unavailable. Select the token and copy it manually.',
                                );
                            });
                        }}
                      >
                        Copy token
                      </button>
                      <button type="button" onClick={() => setIssuedToken('')}>
                        Clear from view
                      </button>
                    </label>
                  )}
                </section>
                <section className="panel">
                  <h2>Revoke a token</h2>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void work(async () => {
                        await api(
                          `/api/projects/${selected}/tokens/${String(form.get('id'))}`,
                          'DELETE',
                        );
                        setIssuedToken('');
                        setMessage('Token revoked.');
                      });
                    }}
                  >
                    <label>
                      Token id
                      <input
                        name="id"
                        required
                        placeholder="Token UUID from creation or audit history"
                      />
                    </label>
                    <button className="secondary" disabled={busy || !project}>
                      Revoke token
                    </button>
                  </form>
                </section>
              </>
            )}
            {tab === 'Audit log' && access.capabilities?.readAudit && (
              <section className="panel">
                <h2>Recent events</h2>
                {audit.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Event</th>
                          <th>Actor</th>
                          <th>When</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.map((event) => (
                          <tr key={String(event.id)}>
                            <td>
                              <code>{String(event.action)}</code>
                            </td>
                            <td>{String(event.actor)}</td>
                            <td>{String(event.created_at)}</td>
                            <td>
                              <code>{JSON.stringify(event.metadata)}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>No audit events are available for this project.</p>
                )}
              </section>
            )}
            <footer>Doctopus Studio · Self-hosted, open source, yours.</footer>
          </main>
        </div>
      )}
    </div>
  );
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<Studio />);
