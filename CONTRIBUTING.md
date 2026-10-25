# Contributing

The project is implementing its roadmap. Start with the [product](docs/planning/01-product.md), [architecture](docs/planning/02-architecture.md), and [delivery](docs/planning/03-delivery-and-launch.md) documents. The README and tests identify runnable capabilities; roadmap features are not automatically implemented.

## Local checks

Install the Node.js version in `.node-version` and npm 11. The workspace pins pnpm 11.25.0 in `packageManager`; install it with `npm install --global pnpm@11.25.0` or use Corepack when available.

Local helper checks use Bash, Git, OpenSSL, GnuPG (`gpg` and `gpgconf`), `zip` and `unzip`. Use Linux, macOS or WSL for these checks. The signing fixtures generate and remove disposable keys in private temporary directories; publishing credentials are unnecessary for development checks. Optional Java, PostgreSQL and Docker acceptance requirements are described below and in their linked guides.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
```

Prettier and ESLint are pinned development dependencies. `pnpm run format` applies formatting; `pnpm run format:check` and `pnpm run lint` enforce it. Dependency build scripts are disabled by the pnpm workspace policy. The committed `pnpm-workspace.yaml` links local packages and mirrors npm's security overrides.

The npm 11 installation path is used for container builds and physically installed package-consumer checks:

```sh
npm ci --ignore-scripts
npm run check
```

Do not alternate managers in the same `node_modules`; use a fresh checkout or remove that generated directory before switching. Commit both `package-lock.json` and `pnpm-lock.yaml` for dependency changes. Update the npm lock with `npm install --package-lock-only --ignore-scripts`, then run `pnpm import` and verify a fresh `pnpm install --frozen-lockfile --ignore-scripts`. Keep overrides in `package.json` and `pnpm-workspace.yaml` aligned. The version audit checks workspace inventories, dependency specifiers, local links and overrides for drift; release preparation updates internal dependency versions in both locks without resolving external packages.

Run `npm run format` to apply formatting. `npm run check` verifies Prettier, ESLint, Markdown, strict TypeScript, compiler tests, and a production build. Browser tests run with `npm run demo:build && npm run test:e2e` after `npx playwright install chromium`. For a system Chromium install, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path.

`PLAYWRIGHT_BROWSER` selects `chromium` (default), `firefox` or `webkit` for the reader, Pages demo and Studio suites. Install the selected Playwright engine and its host libraries first, for example `npx playwright install --with-deps firefox`, then run `PLAYWRIGHT_BROWSER=firefox npm run test:e2e`. Chromium executable overrides apply only to Chromium. Build the mock site with `npm run demo:pages` before `npm run test:pages`. Studio additionally requires a disposable `TEST_DATABASE_URL` initialized with `DATABASE_URL="$TEST_DATABASE_URL" node apps/server/dist/migrate.js`; run it with `npm run test:studio`. Each Studio group uses fresh server rate limits and keeps separate reports and failure traces under `.doctopus/studio-test/`.

If the managed environment's default npm cache is not writable, prefix installation with `npm_config_cache=/workspace/.npm-cache`; keep this machine-specific path out of portable repository configuration.

## Pull requests and commits

Use a short-lived feature branch and target `master`, the main integration branch. Keep changes focused and explain the problem, result, validation, and compatibility impact. Do not include credentials or unrelated generated files.

Use conventional commits and PR titles:

```text
docs(product): clarify versioned search requirements
feat(spec): normalize reusable request bodies
fix(explorer): preserve repeated query parameters
feat(plugin-sdk)!: revise the transform hook contract
```

Allowed types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. Scopes are optional and lowercase. Document breaking changes and migrations in the PR and commit body. Commit and push each completed, validated implementation step.

Check a proposed PR title locally with:

```sh
PR_TITLE='docs(product): clarify release scope' npm run check:pr-title
```

## Automation and release status

The `Repository quality` workflow runs on branch pushes, PRs (including title edits), merge queue candidates, and manual dispatch. Its stable job name is `Quality`. It installs locked tooling and runs the same checks as local development; PR events also validate the title. Ordinary checks retain validation artifacts and publish no registry distributions. Producer-capable jobs declare OIDC/attestation permissions; their signing steps require an explicit release-candidate invocation and clean upstream tag guards. GitHub restricts fork PR token permissions. The required Static mock demo job builds and tests the [local-only Pages demo](docs/pages-demo.md). A separate Pages workflow deploys the exact tested artifact only after a successful quality run for a push to master; its deployment job receives Pages write/OIDC permissions.

The required pnpm job starts from a fresh checkout, installs the pinned manager and frozen lockfile, audits dependencies, and runs formatting, ESLint, types, tooling tests, source tests and production builds. The existing npm source/browser and installed-consumer jobs remain required as well.

The read-only **Browser compatibility** workflow runs daily and on manual dispatch. It tests the reader/playground, local mock demo and Studio on pinned Chromium, Firefox and WebKit engines. Release rehearsal reuses this matrix after preparing the candidate metadata and requires every engine to pass. PR quality keeps its representative Chromium checks. These automated engine journeys do not establish real-device/iOS coverage or replace independent accessibility review.

The full matrix uses the official Playwright Ubuntu 24.04 image pinned to its Linux amd64 digest, with matching browser binaries and host libraries already installed. It runs as the image's `pwuser`, matching the Actions-mounted browser home ownership required by Firefox. Update that image's version and digest together with `@playwright/test`; a required launch check reports the actual engine version. The isolated PostgreSQL service is reached by its container-network name. The matrix performs no live APT installation. Representative Chromium quality jobs continue to use the Ubuntu runner's existing libraries.

The aggregate also requires the Linux Docker [isolated-build harness](docs/isolated-builds.md#validation), which builds an approved worker and checks resource enforcement, artifact parity, cancellation and cleanup after parent death. Its PostgreSQL/API/worker acceptance also runs actual queued Docker builds, cancellation and killed-worker recovery after the real hard deadline. Run both harnesses locally when changing the runner, worker or image; see [worker acceptance](docs/build-worker.md#acceptance).

Dependabot checks npm dependencies and GitHub Actions weekly. Actions are pinned by commit SHA. Maintainers must enable branch rules requiring `Quality` and review; repository files do not activate those settings.

CI also runs PostgreSQL/server and Studio browser integration tests and a Java 17/21/25 × Spring Boot 3.5/4.1 consumer matrix. PostgreSQL integration tests require a disposable `TEST_DATABASE_URL`; the schema-upgrade/runtime-grant fixture additionally needs a test identity with `CREATEROLE` or superuser privileges so it can create and remove its isolated runtime role. This test permission is not a production migration-role requirement. See [build queue acceptance](docs/build-jobs.md#schema-upgrades-and-acceptance). Dependency audits block moderate or higher known advisories. See [governance](GOVERNANCE.md), [security reporting](SECURITY.md), and the [code of conduct](CODE_OF_CONDUCT.md). Contributions are licensed under Apache-2.0; no separate CLA or DCO sign-off is required.

The [candidate workflow](docs/release-provenance.md) tests and signs exact npm, Java and server-image assets from a clean canonical tag. The [publication workflow](docs/publication-plans.md) defaults to a read-only review plan. Confirmed publishing requires reviewed source policy, repository/tag protections and the protected release environment, refreshes security for the accepted image, then runs separate GitHub Packages/GHCR publishers and fresh read-only consumers. npm/Maven jobs use step-scoped repository tokens; only the container publisher and scan producer need OIDC in this workflow. [Registry installation](docs/github-packages.md) requires GitHub authentication for npm/Maven. Source policy permits prereleases with the owner's explicitly recorded review deferral; stable releases still require approved independent reviews. The [published prerelease acceptance](docs/release-acceptance.md) passed every registry gate. See the remaining [launch plan](docs/planning/03-delivery-and-launch.md).

## Framework integration development

The Reader supports a direct OpenAPI URL mode and compiled publication mode. Direct runtime configuration is shared through contracts; browser parsing uses the portable spec normalizer and a precompiled schema validator in a worker. Java and Node serve the same built UI. Run the workspace build before Java packaging: it stages bundled assets, notices and the browser component inventory under the ignored `integrations/java/.reader-resources` directory, which survives Maven clean operations.

Changes to hosting must cover Express, Fastify, Spring MVC and WebFlux, authentication, context paths, deep links and installed-package consumers. `tests/e2e/direct-integration.spec.ts` exercises browser loading, search and the real request editor without generated page-data files. Optional compiled projects continue to use their config files and artifact verification.
