# Development candidates and release gates

The project has a [published and registry-accepted prerelease, 0.2.0-candidate.7](release-acceptance.md), and no approved stable release. The local candidate commands below do not publish packages. Distributions use [GitHub Packages and GHCR](github-packages.md), npm scope `@davidniessen` and Maven group `dev.niessen`; no npm or Maven Central account is required. Doctopus is the selected product name. The accepted release predates the rename; renamed distributions await a new release and fresh registry acceptance. See the [migration guide](migration-doctopus.md). Independent launch reviews remain deferred for prereleases. Never install or execute artifacts from an untrusted pull request.

## Review a release plan

Use a full clone with fetched release tags. The planner checks distribution metadata before reading local Git history. It never edits versions, writes a changelog, creates tags, fetches, pushes or publishes. With no merged release tags, select the initial release explicitly:

```sh
npm run --silent release:plan -- --initial --date 2026-10-22 > /tmp/doctopus-release-plan.json
npm run --silent release:plan -- --initial --date 2026-10-22 --notes
```

After a release, omit `--initial` to use the highest merged canonical `v<version>` tag. `--since <local-ancestor-ref>` selects an explicit baseline; a canonical release tag also supplies its version. `--version <canonical-semver>` records an explicit maintainer-selected target, which cannot precede the checkout's declared version. The default date is the current UTC date; supplying it makes repeated plans reproducible. `--help` lists options. npm's `--silent` keeps the redirected JSON free of npm script headers.

The schema-versioned JSON reports the source commit, dirty state, baseline, declared npm/Java versions, proposed bump/target, classified commits, unclassified messages and Markdown notes. Dirty plans are development evidence. Unclassified messages require manual review; they do not silently become features or breaking changes. Notes group breaking changes, features, fixes/reverts, performance and documentation, and escape commit-supplied Markdown/HTML. GitHub links are included only for a recognized origin, with URL credentials removed.

Features suggest a minor increment; fixes, reverts and performance changes suggest a patch. Breaking changes suggest a major increment on stable versions and a minor increment below 1.0. Existing prereleases advance their prerelease number instead of promoting to stable automatically. Documentation/maintenance changes alone do not infer a bump. Initial releases retain the declared version for review. Metadata already advanced beyond the baseline's proposed increment is retained; the planner never downgrades it. An explicit override remains a maintainer decision, not proof that the version is semantically correct.

Shallow repositories, invalid/unrelated baselines, invalid dates, conflicting target tags, inconsistent versions and oversized histories/messages fail. Plans are bounded to 5,000 non-merge commits, 64 KiB per commit body and an 8 MiB Git output buffer and a 16 MiB JSON plan; narrow a large range with `--since`. A passing plan is not release authorization or signature/provenance verification. Review the complete range, upgrade notes, supported matrix and all gates below before preparing publication artifacts.

## Prepare the reviewed metadata

Generate the plan from a clean full checkout, keep it outside tracked source (for example `/tmp/doctopus-release-plan.json`), and inspect its version, notes, baseline, dirty flag and unclassified commits. The preparer regenerates the proposal from the current source and rejects changed JSON or stale source. Edit source/migration documentation before planning; do not hand-edit the JSON to bypass that comparison.

```sh
npm run --silent release:prepare -- --plan /tmp/doctopus-release-plan.json
npm run --silent release:prepare -- --plan /tmp/doctopus-release-plan.json --apply
npm run check:versions -- --release
```

The first command stages metadata in a temporary directory and audits release alignment without changing repository files. Its JSON receipt lists changed paths and before/after SHA-256 hashes. `--apply` writes a reviewable Git change: all npm workspace versions, exact internal references in every dependency section, matching lockfile entries, runtime version, the Java parent/reactor versions without `-SNAPSHOT`, and a new `CHANGELOG.md` entry. Third-party versions, resolved archives and integrity records stay unchanged. The lockfile retains npm's format and requires no dependency resolution or registry access. Existing changelog introductions and earlier entries are preserved; entries use `## <semver> - YYYY-MM-DD`, and duplicate or unsupported headings fail.

Only tracked regular metadata files are replaced; an absent changelog may be created for review. Metadata symlinks are refused. Preparation stages and validates the full candidate before replacing files, rechecks the source and snapshots, preserves file modes, and audits the installed result. An apply lock serializes preparations for the checkout. A normal failure attempts to restore completed replacements; a concurrent edit is preserved and original recovery metadata is retained with its location in the error. Replacements are atomic per file, rather than a filesystem-wide transaction. An interrupted process or machine can leave partial metadata and a lock; inspect its owner file and Git changes before restoring the checkout and removing the stale lock. No Git history is reset automatically.

After applying, review `git diff`, finish migration/release notes, run all applicable source/browser/integration/Java/package checks against the exact prepared candidate, and commit it with a conventional release message. Applying does not install packages, stage/commit files, create tags, push or publish. The receipt identifies the plan's input commit; publication evidence must identify the final reviewed commit and artifact digests. Runtime/artifact schema versions and documentation API versions are independent and are not changed by this command.

## Run the manual CI rehearsal

The required **Prepared browser compatibility** job runs the reusable [browser workflow](../.github/workflows/browser-compatibility.yml) against the prepared candidate on Chromium, Firefox and WebKit. Every engine must pass the reader/playground, local mock Pages demo and Studio suites. The same workflow runs daily and supports manual dispatch without preparing versions. PR quality retains Chromium as its representative engine. Per-engine reports retain reader/demo output and separate Studio group reports/traces for 14 days; these fixture journeys do not replace real-device or independent accessibility acceptance.

Server-container acceptance also requires the [verified HTTPS proxy rehearsal](deployment.md#automated-https-proxy-rehearsal). Its receipt must bind the selected server image/artifact, pinned Caddy image and current shipped template checksum, at least eight proxy/private-file checks, a verified certificate fingerprint, negotiated TLS protocol and owned cleanup. Public certificate issuance and independent isolation review remain separate gates.

The [offline installation rehearsal](offline-installation.md#automated-acceptance) exports and imports the exact server and pinned database images without tags, detects archive corruption and starts a fresh deployment with registry pulls/builds disabled. Required evidence binds at least eight checks, archive size/checksum, imported image IDs, artifact and prepared runtime version; it requires UID 1000, no application default route, private-file denial, backup with the image override and owned cleanup. Fresh-target recovery must independently use the same database image through its explicit override. This does not establish offline host provisioning or authenticate unsigned distributions.

The [schema upgrade/rollback rehearsal](deployment.md#automated-schema-upgrade-and-rollback-rehearsal) builds the recorded historical schema-1 server independently. Ten required checks exercise real old/new runtimes, refusal of incompatible schemas, failed-migration atomicity, durable metadata preservation, runtime grants, private publications and a fresh-target rollback using the pre-upgrade recovery set and older image. Prepared receipt checks bind both image IDs, the historical source commit, artifact, schema sequence, metadata checksum and owned cleanup. PostgreSQL major-version changes and other historical releases require separate evidence.

The **Release rehearsal** workflow can be dispatched from `master` with a target version, an explicit notes date, and an initial-release or ancestor baseline. Its plan job requires the trusted default branch, validates a read-only proposal, and reads the Java matrix from the normal quality workflow. Each downstream job prepares the same metadata before checking the source/browser/snippets/packages, PostgreSQL/Studio, all supported Java/Spring combinations and isolated Docker builds/worker recovery plus the shipped server/Compose installation and database outage recovery. The isolated-build job builds its image after preparation and verifies that its nonempty runner/worker receipts name the prepared tool version and exact image ID. Server-container receipts must likewise report the prepared tool version, selected server image, at least nine lifecycle checks, private-file coverage and verified cleanup. Recovery receipts must additionally identify a fresh-target backup/restore run, the same image/artifact, at least nine checks and verified target cleanup. Two additional required jobs measure the prepared compiler and reader under the same budgets as the scheduled performance workflow. Evidence must match the prepared tool/publication version and source commit, use the full 10,000-operation fixture or ten cold mobile samples per route, and preserve the existing budgets/profile. Empty, stale, reduced or nonnumeric evidence fails. A final result fails if any required job fails or is skipped.

The workflow uses SHA-pinned actions, read-only repository permissions, full Git history, and quoted environment inputs. Its shared preparation action validates boolean/baseline choices and retains the JSON plan, preview and applied receipt. Source artifacts and current Java results are retained for review. The prepared working tree is deliberately dirty and labeled as an unpublished rehearsal: no tags, commits, registry packages, release entries or deployments are created. A rehearsal does not replace checks against a final reviewed clean commit or signed release artifacts.

Hosted [rehearsal 39984331124](https://github.com/DavidNiessen/doctopus/actions/runs/39984331124) passed at clean source `6f1e5ce`, preparing an unpublished `0.2.0` candidate with the selected `dev.niessen` group. Source/tooling/browser/snippet/package checks, server/Studio acceptance and all six Java/Spring combinations passed. That run predates the added prepared-version Docker job. Expanded [rehearsal 39987857551](https://github.com/DavidNiessen/doctopus/actions/runs/39987857551) passed every job at source `05a0fa9`, including the prepared Docker compiler/worker harnesses and receipt gate. The actual container runtime reported tool version `0.2.0`, UID 1000, no network, a read-only root, enforced memory/CPU/PID limits, no new privileges, seccomp and no capabilities; no publication was activated. The prepared working tree and candidate flags are intentional rehearsal evidence; signed publication, registry installation and approval of final artifact digests remain separate gates.

Latest expanded [rehearsal 39995916569](https://github.com/DavidNiessen/doctopus/actions/runs/39995916569) passed every required job at `36ee79b`. Both performance jobs measured the prepared `0.2.0` tool and publication, passed the full-size evidence gates and retained raw results. The fresh server image `sha256:a0bd1e8e7cba136b98b3d639d73f1f535a4747b3f47d366facd3321d8f877c32` passed installation, role/kernel/resource checks, private-content denial, revocation, restart/idempotence, database outage/recovery and verified cleanup. Normal Quality also passed after a targeted rerun of a Maven Central HTTP 429 failure. The [performance record](performance.md#prepared-candidate-hosted-results) distinguishes these unpublished prepared results from an approved release.

## Local prepared-version rehearsal

A full temporary clone at source `6f21ce4` was installed from the existing npm cache with network access disabled for npm, advanced from `0.1.0` to `0.2.0` through a saved JSON plan, and checked without changing the main checkout or publishing anything. Release-mode metadata alignment, formatting/lint, 63 tooling tests and 364 compiler/component tests passed. The candidate also passed all 27 reader browser journeys, 60 executable snippets across five languages, nine PostgreSQL integration tests, the Studio publishing journey, and all 12 installed npm components. The Java matrix passed 60 tests across JDK 17/21/25 and Spring Boot 3.5.16/4.1.1 with no skips.

That rehearsal caught and corrected saved-plan optional-field mismatches and package JSON formatting before the final successful run. Its candidate remains development evidence from a prepared working tree; it is not a published or approved stable release. The shared CI preparation action was separately exercised in read-only/apply modes against a clean temporary clone, and workflow linting/matrix-output checks passed locally. The action's input-boundary and early-rejection tests also participate in the normal tooling suite.

The targeted Java distribution follow-up at `f75e9ef` also passed the exact preparation action and production build in a fresh `0.2.0` clone. It verified both runtime JARs, four source/Javadoc archives, all five Spring IDE properties, the bound baseline dependency SBOM and both installed Java 21 / Boot 4.1.1 consumers (four tests, no skips, two offline compilations). See [recorded Java validation](java-validation.md#recorded-linux-validation). The temporary clone was removed after retaining unpublished evidence; the main checkout remains on its development version.

## Pack and verify npm components

First run the [distribution version audit](versioning.md), which also participates in `npm run check`. The current checkout permits development Maven snapshots; release-mode alignment is a later gate.

Use the pinned Node/npm versions and a clean checkout for reviewable candidates:

```sh
npm ci --ignore-scripts
npm run check
npm run test:packages
```

`test:packages` first packs all 12 public components, including the reader runtime required by the CLI. It stages built output, tracked source for source/declaration maps, package exports, README, Apache-2.0 LICENSE and NOTICE in temporary directories. It removes workspace build scripts and development dependencies from the packed metadata. It checks archive contents, executable/export targets, reader assets, and npm SHA-512 integrity, then records SHA-256 hashes, file inventories, the source commit and whether the working tree was dirty. A dirty run is development evidence, not an approved release candidate. `npm run release:pack` produces only the archives/inventory; build first.

The consumer check installs the archives into a temporary project outside the workspace, audits its dependency tree at the moderate threshold, reinstalls from its lockfile using the local npm cache with network access disabled for npm, and runs the installed code. Internal package directories must be physical installs rather than workspace symlinks. The smoke covers strict public TypeScript declarations, CLI initialization, trusted MDX and plugin workers, plugin conformance, strict doctor validation, artifact checks, static serving, and authenticated Express/Fastify mounts under a subpath. Its Node TypeScript fixture selects `types: ["node"]` and keeps `skipLibCheck: false`; this avoids auto-loading unrelated ambient MDX JSX types. Projects that consume MDX types directly must configure the JSX runtime they use.

Results remain in `.doctopus/npm-candidates/<commit>-<run>/`: archives, `manifest.json`, `consumer-result.json`, the installed consumer lockfile and a CycloneDX SBOM. The lockfile/SBOM describe this tested consumer, including its integration hosts, rather than every Docker/Java distribution. The source workflow retains candidates and browser reports for 14 days. Hosted Actions is enabled; source and aggregate Quality results are tracked in the [implementation progress](planning/04-progress.md). Local candidate results remain separate evidence.

Browser builds collect license texts for packages identified in bundle source maps plus Vite's generated preload helper. Reader exports and Studio distributions include `assets/THIRD_PARTY_NOTICES.txt`; static exports retain that file. This is attribution collection, not completion of the release-wide dependency/license review.

## Java candidate distributions

`npm run test:java-consumers -- --matrix` builds and installs a baseline development candidate, inspects runtime/source/Javadoc archives and generated Spring configuration metadata, and consumes the same runtime JARs outside the source checkout across the supported matrix. It retains the parent/module POMs, all six JARs, sanitized logs, SHA-256 inventories and a baseline CycloneDX dependency SBOM with test dependencies excluded. Project-component SBOM hashes are bound to the inspected parent POM/runtime JARs; applications should produce their own resolved runtime inventory. See [Java validation](java-validation.md) for prerequisites and exact scope.

The regular and prepared-version Java jobs retain these unpublished candidates and SBOMs. GitHub producer signatures, actual protected GitHub Packages publication and fresh authenticated registry installation remain separate gates. The local candidate commands do not create tags, public packages or release entries.

## Container candidate inventories

Regular Quality and the prepared release rehearsal inventory the exact server image that passed Compose acceptance. The scanner is Syft 1.55.0 for Linux x64; both the upstream archive and extracted executable have pinned SHA-256 checksums. The installer verifies cached binaries before reuse, checks downloaded bytes before extraction and installs only the verified executable. It uses HTTPS and the host's existing proxy/CA configuration.

After building packages and the server target, run from the repository root:

```sh
node scripts/install-inventory-tool.mjs
node scripts/container-inventory.mjs "$(cat /tmp/doctopus-server.id)" > .doctopus/container-inventory-evidence.json
node scripts/check-container-inventory.mjs "$(cat /tmp/doctopus-server.id)"
```

The inventory command accepts an immutable server image ID or repository digest, resolves it against the local Docker daemon and rejects the worker target. It preserves Docker registry/proxy configuration while explicitly selecting the local socket. Scanner update checks and Java network lookups are disabled. Its inputs are the actual image filesystem and package databases, including Debian packages and the Node runtime. A source lockfile inventory cannot substitute for that result.

Each unique `.doctopus/container-candidates/` directory contains `server.cdx.json` (CycloneDX 1.7) and `report.json`, with the image ID, tool/source versions, scanner checksums, inventory checksum and component counts. `.incomplete` marks an unfinished result and causes the receipt checker to refuse it. The receipt checker confines the inventory path to the candidate directory, validates its bytes and subject, requires the pinned scanner and checks every workspace package against the current tool version. It also requires OS packages, the supported Node runtime and server/database dependencies. Both workflows retain the inventory and receipt; prepared acceptance requires the same version and image as the running server.

A local scan of the development server image found 506 npm packages, 88 Debian packages, the Node runtime and file records. This is inventory evidence, not a vulnerability verdict, license approval or signed release. Bundled browser attribution remains documented separately. The image ID recorded here is Docker's immutable configuration ID; registry manifest digests and signed publication provenance remain separate promotion evidence. Source fields identify the checkout running the inventory; they do not prove how the image was built. Candidate reports explicitly remain unsigned and unapproved for publication.

Current inventories also support Alpine package identities after the runtime refresh. [Container vulnerability acceptance](container-security.md) is now a separate required gate: the pinned scanner assesses the exact inventory bytes with a valid database no older than 48 hours. High, critical, unknown-severity and suppressed findings block acceptance; unavailable fixes are included. Receipts retain raw finding checksums and database identities and must match the prepared tool version, tested image and inventory. Daily advisory checks run separately from deployment acceptance. Automated scans do not replace independent review, final dependency/license approval or authenticated release provenance.

Prepared [rehearsal 40000268183](https://github.com/DavidNiessen/doctopus/actions/runs/40000268183) passed every required job at `28b43aa`, including the new image inventory and incomplete-result guard. The actual prepared `0.2.0` server image is `sha256:6ba4a47df57b9fa186a5511b906887e68a6da408890a3f3e116228cd0a9626f5`; its CycloneDX checksum is `91595452e487e03d95c8141b4d08300d8174b72337568f71eccaac88889ca363`. Retained bytes were rehashed after download and validated against every prepared workspace version, scanner/subject identity and OS/runtime requirements. Normal Quality also passed every job. These receipts remain unpublished, unsigned rehearsal evidence.

## Clean-tag candidate provenance

The [verified release-candidate workflow](release-provenance.md) reuses the required quality, browser and performance gates against reviewed, clean release metadata. It retains the exact tested npm/Java files and Docker image, attests them in their producing jobs and verifies source-bound signatures and bytes after download. This manual tag-only path creates no registry packages or release entries; it does not turn the dirty prepared-version rehearsal into a signed stable release.

## Review publication destinations and blockers

The [publication workflow](publication-plans.md) verifies the exact successful candidate run/attempt, remote tag, producer signatures, bytes and repository-bound destinations. Its default read-only run retains reviewable digests and launch-review statuses. Explicit publication requires approved policy, actual branch/tag protections and the protected release environment. Separate GitHub npm/Maven and OCI publishers promote exact accepted bytes; fresh read-only consumers verify hashes, producer/promotion attestations and installed behavior. npm/Maven readers use GitHub authentication; the container probe is anonymous. No production GPG key or external publishing account is needed. [Candidate .7 acceptance](release-acceptance.md) passed every publisher and consumer gate after owner environment approval; this does not approve a stable release.

## Still required before a stable production release

Complete the deferred independent security, isolation, accessibility, license reviews and external pilots, resolve blocking findings, and finish the owner's deferred product naming decision. Review the remaining [stable launch checklist](planning/03-delivery-and-launch.md#6-open-source-launch-checklist), final version/changelog, support commitments and exact artifact digests. Repeat candidate acceptance, fresh security and protected publication for the stable version; prerelease approval does not carry forward. Real GitHub-registry installation is now verified for .7; this does not establish a fully air-gapped server deployment or every production topology.
