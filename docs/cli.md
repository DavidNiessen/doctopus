# CLI reference

Use the [lifecycle inventory](lifecycle.md) to report deprecations, resolve migration targets and enforce explicit deadline policies in CI.

Build the repository with `npm ci && npm run build`. Commands below use `node packages/cli/dist/main.js`; the packaged executable is named `doctopus`.

| Command                          | Purpose                                                   |
| -------------------------------- | --------------------------------------------------------- |
| `init [directory]`               | Create a project without overwriting existing files       |
| `import-spec <url> [project]`    | Explicitly validate and save a remote spec snapshot       |
| `vendor-spec <policy> [project]` | Save pinned root/reference sources for offline builds     |
| `build [project]`                | Compile and verify a static publication                   |
| `export [project]`               | Alias for build; output is portable static files          |
| `source-info [project]`          | Inspect visible source digest/counts without running code |
| `isolated-build [project]`       | Build offline in an approved restricted Docker worker     |
| `dev [project]`                  | Build, serve and watch inputs; refresh after rebuilding   |
| `serve <directory>`              | Serve an existing publication with security headers       |
| `validate [project]`             | Check configuration, specs and guides                     |
| `doctor [project]`               | Offline examples, links, fragments and coverage policy    |
| `diff <before> <after>`          | Classify breaking and uncertain API contract changes      |

`build` and `dev` accept `--config`, `--output`, and `--trust-plugins`. Output must stay inside the project's `.doctopus` directory to protect source files. `serve` and `dev` accept `--port` and `--host`; the default interface is loopback.

`serve` verifies the publication manifest and all listed checksums before startup, then serves only listed files and directory aliases backed by a listed index page. Extra files and the manifest itself are not automatically public. A supplied programmatic mount must match the compiled `basePath`. Keep served artifacts immutable; startup verification does not rehash each response.

Programmatic callers can use `await server.reloadPublication()` on the result of `createStaticServer` to verify a replacement publication and update the allowed file set. A failed reload makes documentation and `/health/ready` return 503 while `/health/live` remains available. Repair the artifact and reload to recover. A changed `basePath` requires restarting the server.

See [pinned reference snapshots](reference-snapshots.md) for multi-file specs, explicit per-source hashes and offline resolution. See [remote spec importing](remote-import.md) for exact origin controls, authentication, SHA-256 pins, private generators and atomic refreshes.

See [isolated builds and source approvals](isolated-builds.md) for `source-info --source-mib <limit> --json` and `isolated-build --image <immutable-image> --source-digest <approved-digest>`. Inspection requires no Docker and does not change project output. The build runner requires a supported Linux Docker host and explicit trust flags for executable content.

## Configuration

```yaml
schemaVersion: 1
name: My API
basePath: /docs
specs:
  - id: public
    path: openapi.yaml
    version: v1
guides: guides
theme:
  accent: '#148567'
  radius: 10
  density: comfortable
  font: system
```

A project can contain multiple API ids and versions. API ids and versions must be URL-safe. Ordinary relative references must resolve inside the project. External HTTP references require an explicitly imported [reference snapshot](reference-snapshots.md) and its `specs[].references` manifest; compilation always resolves from local bytes.

## Guides

Markdown front matter supports `title`, `description`, `group`, and numeric `order`. Tables, lists, code fences, blockquotes, and safe links are supported. Raw active HTML is removed. Heading anchors are deterministic. Trusted MDX and reusable interactive guide components are available with `--trust-content`; see the authoring reference.

## Trust and credentials

Reviewed build plugins and [browser reader extensions](reader-extensions.md) require `--trust-plugins`. Build plugins execute local code; reader extensions are copied into the artifact and execute with full page-origin privileges in visitors’ browsers. File-based build plugins run in fresh workers with external time and output limits; they retain the build user's filesystem, network and environment access. This is not a security sandbox. See the [SDK and conformance reference](plugins.md). Do not enable plugins from untrusted repositories. Reader credentials remain in memory; copied request examples use placeholders. OAuth public clients can use [authorization code with PKCE](explorer-auth.md). The explorer sends browser requests directly, so the target API must permit the reader origin through CORS.

## Verification and diagnostics

Every build writes `manifest.json` with SHA-256 output digests and verifies it before replacing the previous output. Failed builds leave the prior publication available. Doctor additionally checks authored examples, local links/fragments and documentation coverage offline; warnings can be made fatal with `--strict`. See the [doctor reference](doctor.md) for coverage and resource limits. Contract diff checks schema, authentication, serialization and operation changes, with failing review findings for uncertain compatibility. See the [classification coverage and CI exit codes](contract-diff.md).

## Self-hosted publication protocol

The management server consumes immutable artifacts in its configured `ARTIFACT_ROOT`. Build with `basePath: /docs/<project-slug>`. Verify the generated manifest, then copy the complete build directory into `<ARTIFACT_ROOT>/<manifest.artifactDigest>` using an operator-controlled deployment process. Keep that directory immutable once registered.

Authenticate management API requests with an operator or project-scoped bearer token. Create a project, register its artifact, and activate it:

1. `POST /api/projects` with `slug`, `name`, and `visibility` (operator only).
2. `POST /api/projects/<id>/artifacts` with `artifactId` (publisher).
3. `POST /api/projects/<id>/publications` with `artifactId`, `expectedPublicationId` (null for the first publish), and a unique `idempotencyKey` (publisher).

Publish again with the same key and artifact to safely retry. A stale expected publication returns HTTP 409. Roll back by activating a previously registered artifact with a new key and the current expected publication id. History remains immutable.

Use `doctopus stage <directory> --store <artifact-root>` to verify and atomically stage a build; retries are idempotent. Then set `DOCS_PUBLISH_TOKEN` securely and use `doctopus publish <artifact-id> --server <https-origin> --project <slug-or-id>`. For loopback testing only, add `--insecure-development`. An optional `DOCS_IDEMPOTENCY_KEY` makes CI retries reuse the same publication request.

The protocol stages through operator-controlled storage rather than accepting arbitrary archives from the browser. Isolated upload/build workers are further roadmap work.

## Trusted guide execution

Build, export, validate and dev accept `--trust-content` for reviewed MDX. It is separate from `--trust-plugins`. Markdown needs neither flag. See the [authoring and component reference](authoring.md) for execution boundaries, frontmatter, reusable components and source limits.

## Incremental local preview

After the initial verified build, `dev` reuses its API graph for plain Markdown body edits whose navigation metadata stays unchanged. It updates the affected pages, search data and manifest, then asks you to refresh the browser. Navigation, configuration, spec, assets, plugins and trusted MDX changes use a full rebuild. Full development rebuilds reload the verified file set; incremental guide edits retain the same paths and avoid another full checksum pass. Restart `dev` after changing `basePath`. Do not edit generated preview files manually. Staging and publishing always verify the complete artifact. See the [measured limits and invalidation behavior](performance.md).

## Plugin conformance

`plugin-check <file> [project] --trust-plugins` substitutes one reviewed plugin for the fixture's configured plugins and compiles the complete project twice. Source hooks run before ordinary OpenAPI validation, followed by theme/graph hooks and build-time snippet generation in fresh workers. The check fails on invalid metadata/output, changed declared inputs or nondeterminism. Use `--trust-content` separately when its guides contain reviewed MDX.
