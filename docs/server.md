# Self-hosted server operations

The optional Fastify server uses PostgreSQL for projects, permissions, opaque sessions, hashed access tokens, publication pointers, and audit history. Static exports continue to work without it. Executable queued builds require a [separate Linux worker](build-worker.md); the HTTP server never starts source code or needs the Docker socket.

An operator can explicitly enable the [authenticated API relay](api-relay.md) with `RELAY_CONFIG_FILE`. It requires assigned project membership, destination/header policy and bounded audited requests. It is disabled by default; public documentation does not grant anonymous relay access.

## Required configuration

| Variable                        | Purpose                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                  | PostgreSQL connection string; configure verified TLS for remote production databases                   |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Optional per-statement deadline, including locks; runtime default 10000 ms, migration default 60000 ms |
| `DATABASE_QUERY_TIMEOUT_MS`     | Optional response-read deadline; defaults to statement timeout plus 5000 ms                            |
| `ROOT_TOKEN`                    | Random operator bearer token with at least 32 characters; generate and store securely                  |
| `PUBLIC_URL`                    | External HTTPS origin used for cookies, OIDC callbacks and CSRF checks                                 |
| `ARTIFACT_ROOT`                 | Durable immutable artifact storage directory; default `/data/artifacts`                                |
| `HOST`, `PORT`                  | Listening interface and port; defaults `0.0.0.0:8080`                                                  |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | Optional identity provider discovery issuer and client id                                              |
| `OIDC_CLIENT_SECRET`            | Optional confidential-client credential, supplied through a secret store                               |
| `OIDC_ALLOWED_HOSTS`            | Additional operator-approved hostnames for OIDC endpoints                                              |
| `SHUTDOWN_TIMEOUT_MS`           | Graceful shutdown deadline, default 30000 ms; integer from 1000 to 300000                              |
| `INSECURE_DEVELOPMENT`          | Explicitly allow HTTP on loopback for local testing; never use in production                           |

Run `npm run build`, execute `node apps/server/dist/migrate.js` with the schema-owner connection, then run `npm run server` with the runtime connection. `DATABASE_URL_FILE` and `ROOT_TOKEN_FILE` support read-only secret files instead of environment values. Do not put production secrets in committed environment files. See the [container deployment and recovery runbook](deployment.md).

## Authentication and authorization

Operator requests use the root bearer token. Per-project tokens are created through `POST /api/projects/<id>/tokens` with a label, role, and expiry in days (1–90). The token is returned once and stored as a SHA-256 hash. Administrators can revoke it immediately.

OIDC login uses `/auth/login` and the registered callback `/auth/callback`. State, nonce, PKCE, issuer, audience and signature are checked. Reader identity is the immutable issuer + subject pair, never an email address. Bind that subject to a project role through `PUT /api/projects/<id>/roles`. Viewer, editor, publisher, and admin roles are ordered; public documentation grants anonymous reading, while all mutations require credentials.

Session cookies are opaque, HttpOnly, Secure on HTTPS, SameSite=Lax, and backed by expiring database records. Studio exchanges a supplied operator/project token through `POST /auth/token` for a session; raw credentials are cleared from the form. Token-backed sessions recheck revocation on every request, and rotating the operator token invalidates its existing sessions. Cookie-authenticated mutations require the exact configured origin. Logout deletes the session. Role revocation is checked on subsequent requests, including direct requests for search indexes, JSON data, specs and JavaScript assets.

### Studio sessions and navigation

Studio binds requests to the current project and screen. Navigation cancels outstanding requests, clears displayed tokens and resets project-specific forms. Late responses cannot populate a different project or restore an old token. Multi-request workflows stop before their next request when their originating screen closes. A 401 clears private workspace state and returns to sign-in; a 403 leaves the authenticated session available for permitted actions.

Publication controls wait for the current project's history before accepting an artifact or activating it. An initial history failure keeps the controls disabled and offers **Retry publication history**. Entry and activation also stay disabled while an action is pending. Switching projects or screens invalidates the prior readiness; returning loads history again.

Sign-out immediately cancels workspace requests and clears any displayed token. The workspace is disabled while server sign-out is pending. Confirmed sign-out clears session-local state, including pending build actions. If server sign-out cannot be confirmed, Studio reports that uncertainty and keeps **Sign out** available for retry. It does not claim the remote session has ended. A delayed startup authentication probe cannot override a later successful sign-in.

Cancelling a request does not undo an action already accepted by the server. Review publication/build history and audit events after an uncertain response. A token created before navigation may remain valid even though its response was discarded; use its creation audit entry to find the token ID and revoke it if needed. Never put a token in an issue, screenshot or build log.

### Current project permissions

`GET /api/projects/<id-or-slug>/capabilities` requires authenticated viewer membership, including on public projects, and returns `{projectId, publish, manageAccess, readAudit}`. Publishers can publish and read publication history; administrators can additionally manage identity/token access and read audit events. The operator has every project permission. Unknown query fields fail with 400; absent projects return 404 and missing membership returns 401/403. Responses use `Cache-Control: no-store`. This endpoint is available for embedded repositories without a build queue as well.

Studio shows project creation only to the operator, identified by `/api/me`'s existing `operator` flag. Other navigation and mutation forms follow the current project capabilities. Permissions refresh on navigation, every thirty seconds while the page is visible, and through **Refresh projects**. A role reduction removes unavailable forms and returns their active screen to Overview. Losing membership clears the selected project and removes its cached entry; refresh the project list after access is granted again. Invalid or unavailable permission responses withhold privileged forms and expose a retry action.

Capability flags guide the interface; each API request independently checks authorization. An outdated flag cannot grant publication or administration rights. [Build permissions](build-jobs.md#management-http-api) remain separate because source approval is operator-only even for project administrators.

## Deployment boundary

Terminate TLS at a trusted reverse proxy. The server does not blindly trust forwarded client addresses. Rate limits use the directly connected address; configure the proxy's limits as well. Management/authentication traffic has a separate 300-request/minute bucket; credential-bearing reader traffic has a 12,000-request/minute bucket. Anonymous static traffic does not consume those buckets. Keep the management API private when practical and grant publishers only access to the projects they maintain.

Artifacts are trusted executable web content and must be produced by reviewed builds. Operators control staging directories and keep them immutable. Do not grant untrusted authors write access to published artifacts or execute their plugins/MDX in a privileged process. Custom reader code has page-origin privileges; isolate documentation and administrative origins when supporting untrusted publishers.

## Health, backup, and recovery

`/health/live` reports process liveness. `/health/ready` checks database connectivity and returns 503 when unavailable. Use both for orchestration and monitoring.

Back up PostgreSQL and all referenced immutable artifact directories as one recovery set. Retain metadata and artifacts through the rollback window. Restore into a fresh environment, verify artifact checksums, then reconnect the metadata database before exposing traffic. A prior container alone cannot roll back a database schema migration.

Migrations use a transaction and advisory lock. The current runtime requires schema version 2; the matching migration executable upgrades version 1 atomically and rejects unsupported histories. The Compose deployment separates migration ownership from the runtime role and enforces an append-only audit log for that role. Never delete referenced artifacts during backup or publication. The recovery command restores only into a fresh deployment and verifies artifact checksums. Multi-replica shared storage and independent isolation acceptance remain release gates. The PostgreSQL adapter and server expose [durable authenticated build jobs](build-jobs.md), a [separate worker](build-worker.md) and [Studio build controls](studio-builds.md).

## Database deadlines and failed transactions

Runtime metadata statements default to 10 seconds on PostgreSQL and 15 seconds for the driver to receive a result. The migration executable defaults to 60/65 seconds. `DATABASE_STATEMENT_TIMEOUT_MS` accepts integer milliseconds from 100 to 300000. `DATABASE_QUERY_TIMEOUT_MS` must exceed the statement deadline and stay at or below 360000; when omitted it is the statement value plus 5000. Both executables validate their options before opening pools. Connection acquisition retains its five-second timeout. These are per-query budgets; a transaction with several statements can take longer.

The driver deadline is applied explicitly to every metadata/transaction query, including BEGIN and COMMIT, so a legacy `query_timeout=0` in the connection URL cannot remove it. PostgreSQL receives the statement deadline and an idle-open-transaction limit matching the driver deadline. Other PostgreSQL startup options in an operator-supplied connection URL can override server-side settings; keep them consistent with the application configuration. Relay audit writes retain their separate four-second statement/five-second read budgets and pool.

Failed transactions discard their connection. PostgreSQL rolls back the open transaction when that connection closes; an uncertain or still-running query cannot return to the pool. A lost COMMIT acknowledgement can leave an uncertain publication result. Check publication history and retry with the original idempotency key and expected pointer. Recognized PostgreSQL connection failures, capacity errors and database/read deadlines produce generic HTTP 503 responses, including on private documentation and worker routes. SQL, authentication and programming errors retain their existing classification. Readiness returns unavailable when its database read fails; liveness remains independent of PostgreSQL. Queries and credentials are not added to response logs.

Programmatic consumers can import `PostgresRepositoryOptions` and pass `statementTimeoutMs`/`queryTimeoutMs` to `new PostgresRepository(connectionString, options)`. `migrate: true` selects the longer defaults and schema-owner workflow. The migration flag is captured when the repository is constructed. These controls preserve verified TLS and the existing runtime/migration role boundary. Programmatic calls reject with `RepositoryUnavailableError` from `@davidniessen/doctopus-domain` for recognized availability failures; its `cause`, diagnostic message and optional driver `code` remain available to trusted callers. Do not expose these details in client responses. Neither adapter nor server automatically retries mutations: a 503 cannot establish whether a write committed.

Acceptance uses actual PostgreSQL table locks and a local TCP proxy. It verifies statement cancellation, atomic project/role/audit rollback and retry, a blackholed authenticated response, health recovery, and a lost timeout response during a transaction. The proxy remains a test fixture; no production relay or TCP proxy is introduced.

## Process shutdown

The executable owns a single shutdown path for SIGINT and SIGTERM, including repeated or mixed signals. It stops accepting requests, lets active HTTP responses finish, closes newly idle keep-alive sockets, then ends both PostgreSQL pools. A response whose headers are sent during draining carries `Connection: close`; a stream already in progress can finish before its socket closes. Programmatic `createServer()` callers keep ownership of their repository and process signal handlers; call `app.close()` before `repository.close()`.

A signal during startup marks it cancelled: resource acquisition settles before cleanup, and the executable checks cancellation before listening. Startup failures, including schema initialization and port binding, use the same cleanup path. Error logs contain a generic operational message rather than raw exceptions or connection credentials.

`SHUTDOWN_TIMEOUT_MS` starts when shutdown is requested, defaults to 30000, and accepts integer milliseconds from 1000 to 300000. If startup or cleanup does not settle within that budget, or cleanup fails, the executable exits with status 1. A successful signal shutdown exits normally; startup failure remains nonzero even when cleanup succeeds. A forced exit can interrupt requests. For an uncertain publication result, inspect publication history and retry with the original idempotency key and expected publication pointer.

Configure the supervisor's termination grace period above this deadline. The supplied Compose and Kubernetes templates allow 45 seconds for the default 30-second application budget. Increase both values together in deployment overrides. These process checks do not establish Kubernetes/multi-replica or database outage acceptance.

## Integration validation

`TEST_DATABASE_URL` must point at a disposable PostgreSQL database. Run `npm run build && npm run test:integration`. Tests use a real database and a local signed OIDC provider, including private artifact access, token revocation, CSRF, state/nonce/PKCE, concurrent publication and audit records. Spawned production executables connect to that database, then encounter either a nonexistent schema search path or an occupied listener port; both must release their pools with a nonzero exit. A five-second hard test timeout distinguishes cleanup from the pool idle timeout. The regular source suite additionally sends actual OS signals to isolated child servers and verifies live HTTP/stream draining, repeated signals, startup cancellation and forced shutdown deadlines. Missing database configuration fails the suite rather than skipping it.

## Immutable metadata cache

The reader caches only manifest file allowlists, with bounded LRU storage and coalesced loads. Permissions and active publication pointers remain fresh database reads. Changing a publication or revoking a token/role takes effect on the next request. Root-token rotation deletes stale operator sessions rather than turning their internal markers into ordinary user identities. Fault-injection tests verify readiness returns 503 and cached private content stays unavailable when repository reads fail. See the [server delivery measurements](performance.md).
