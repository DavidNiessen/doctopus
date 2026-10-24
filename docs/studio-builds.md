# Studio build controls

Studio's **Builds** tab lets project members review source approvals and queued build history. It appears when `/api/me` reports `builds: true`; embedded repositories without the build-job port retain the existing navigation. The PostgreSQL server supplies this port. Configure the separate [build worker](build-worker.md) before expecting queued jobs to run.

## Approve and prepare a source

An operator opens **Approve a source**, supplies a label, optional revision, the JSON from `doctopus source-info <directory> --json`, and an immutable builder image. The form accepts either the complete inspection envelope or its `source` object. It defaults to `docs.config.yaml`, no executable plugins/MDX trust, and the runner's standard resource limits. Review trust decisions and limits before approval. The server independently validates every field.

Approving metadata does not upload source code, check out a repository or configure a worker. Expand the approval, copy its data, and add the matching local directory to the worker registry. The source snapshot, configuration, image, trust flags and resource limits must match exactly. The project configuration must use the literal `basePath: /docs/<project-slug>`. Changing source input requires a new inspection and approval.

## Queue, review and publish

Select an active approval and choose **Queue build**. Editors can enqueue and cancel; viewers can review history. Administrators can revoke approvals, cancelling their queued/running jobs. Only the operator can approve executable source policies. Studio requests current project capabilities on every refresh; API authorization remains authoritative for every action.

History displays bounded job state, attempts, worker identity, update time, a safe failure category and the verified artifact digest. Sources and jobs each have independent cursor pagination, with at most 100 entries per page. Revoked approvals are hidden by default and cannot be selected for a new build. The tab refreshes every ten seconds while displayed jobs are active, otherwise every thirty seconds; hidden tabs pause polling. **Refresh builds** requests current state immediately.

A successful build registers an immutable artifact. It does not activate a publication. A publisher can choose **Review artifact from build**, which opens Publications with the artifact digest filled in and a refreshed publication pointer. **Verify and publish** remains an explicit, separate action. Concurrent publication conflicts retain the server's expected-pointer protection.

## Uncertain actions and navigation

Approval and enqueue requests receive an idempotency key once. If a response is lost or a server failure leaves the outcome uncertain, Studio retains the original action in memory. **Retry pending action** reuses its original payload and key. It cannot enqueue a duplicate after an acknowledgement was lost. Cancel and revoke retries target the original record.

Pending actions survive switching Studio tabs or projects within the connected session. They are not written to browser storage and are cleared by a successful sign-out or page reload. Review history before using **Discard retry after reviewing history**; discarding an uncertain action does not undo it. After a reload, inspect history before issuing a new action.

Changing the project or leaving Builds cancels its outstanding requests and ignores late results. Mutations are never automatically retried. Management requests stay on the current origin, reject redirects, have a thirty-second deadline and accept at most four MiB of JSON. Source/worker host paths, lease credentials and arbitrary build logs are not displayed.

## Acceptance

`npm run test:studio` requires a disposable, migrated `TEST_DATABASE_URL` and an installed Playwright engine. `PLAYWRIGHT_BROWSER` selects `chromium` (default), `firefox` or `webkit`; see [local browser setup](../CONTRIBUTING.md#local-checks). It discovers every Studio browser acceptance file and runs each against a fresh server process, retaining the production per-IP rate limits without charging unrelated scenarios to one shared bucket. Separate reports and failure traces stay under `.doctopus/studio-test/`. For focused runs, invoke `npx playwright test --config playwright.studio.config.ts <file-or-filter>` directly. Acceptance covers approval, enqueue, native artifact completion through the real HTTP API, explicit private publication, acknowledgement-loss retry, running cancellation, source revocation, viewer/editor restrictions, project switching, bounded pagination and mobile accessibility. Worker execution and process-death recovery use the separate real-Docker [worker acceptance harness](build-worker.md#acceptance).
