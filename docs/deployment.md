# Container deployment and recovery

This is the tested single-host, filesystem-storage deployment for the prerelease. It does not yet provide a production support commitment. Use an external TLS reverse proxy, encrypted disks and off-host backups. Keep source builds and plugins outside the reader container.

Use the operator-only [isolated build runner](isolated-builds.md) to compile documentation in an offline container with enforced resources and verified publication export. The source runner belongs on a separate trusted build host; do not grant the application server access to the Docker socket.

## Start a fresh installation

Requirements: Docker Engine with Compose v2, Node.js 24 for the operator scripts, and a clone of this repository. Ports bind to loopback. PostgreSQL is on an internal network and has no published port.

```sh
node scripts/init-deployment.mjs
export PUBLIC_URL=https://docs.example.com
export COMPOSE_PROJECT_NAME=doctopus
# Builds from the committed lockfile; the base images are pinned by digest.
docker compose -f deploy/compose.yaml build
docker compose -f deploy/compose.yaml up -d --wait
```

`DOCS_IMAGE` selects the server and migration image; its default is the local `doctopus:local` build. For a reviewed prebuilt distribution, set it to your full repository reference with `@sha256:...` and pull the selected image before using `up --no-build`. Recovery helpers honor the same selection. No public release image is implied by this setting.

You can also pin an image built locally without changing shared tags:

```sh
docker build --target server --iidfile /tmp/doctopus-server.id .
export DOCS_IMAGE="$(cat /tmp/doctopus-server.id)"
docker compose -f deploy/compose.yaml up -d --no-build --pull never --wait
```

Keep `DOCS_IMAGE` set to the compatible immutable image during backup and fresh-target restoration. Retain or mirror that image and the pinned PostgreSQL image with the recovery set. A configuration ID identifies a locally cached image; registry distribution uses its repository manifest digest. Build or load required images before using `--pull never`.

The setup script refuses to replace existing secrets. The containing directory is private (0700); files inside it are read-only and readable by the different container users through Docker secret bind mounts. Do not relax the parent directory permissions. Configure your secret manager in place of these files on a managed platform. Store an encrypted copy separately from the application backups. Database password changes require PostgreSQL role rotation as well as updating the matching connection secret; replacing a file alone does not change a database password.

Only for local evaluation, use `PUBLIC_URL=http://127.0.0.1:8080 INSECURE_DEVELOPMENT=true`. Production requires the actual HTTPS origin. Visit `/admin/` and supply the operator token from your secret store through its secure input. The token is exchanged for an opaque session. Do not pass tokens as command line arguments or paste them into issue reports.

The `migrate` job owns the schema, applies migrations under a transaction/advisory lock, and grants the runtime role access. The application role cannot create schema objects, mutate migration history, or update/delete audit rows. The application starts only after migration succeeds. Remote PostgreSQL deployments must use verified TLS and equivalent owner/runtime grants. For a source checkout, run `node apps/server/dist/migrate.js` with the migration connection before `npm run server` with the runtime connection; set `DB_RUNTIME_ROLE` during migration to apply the grants.

The current image uses the pinned Node 24.22.1 Alpine runtime and contains no npm, npx, Yarn or Corepack executables. Build dependencies in the build stage; deploy reviewed immutable images instead of installing tools into a running service. See the required [container vulnerability checks](container-security.md) and their recorded evidence limits.

The current runtime requires schema version 2. Its migration upgrades version 1 atomically, retaining existing metadata and adding the [build queue tables](build-jobs.md). Run the matching migration job during an upgrade and retain a pre-upgrade recovery set with its compatible image. A version 1 runtime cannot start against a version 2 database; reverting the application image alone is not a schema rollback. The server provides authenticated source/job HTTP routes. Configure the [separate build worker](build-worker.md) for execution and use [Studio build controls](studio-builds.md) to manage approved sources and queued work.

The reader runs as UID 1000, drops capabilities, uses a read-only root filesystem, and mounts artifacts read-only. Only a separate trusted publisher should mount the artifact volume writable. Build a project with `basePath: /docs/<project-slug>`, stage its verified output into that volume using the CLI image, then activate it through Studio or `doctopus publish`. See [CLI publishing](cli.md). A publication stores a digest and changes a database pointer atomically; changing an artifact in place is unsupported.

`deploy/Caddyfile` is a reverse-proxy configuration template. Set its `DOCS_HOST` and put Caddy on the application's frontend network (or change the upstream to the host's loopback port). Retain `/auth/callback`, `/admin/`, `/api/` and `/docs/` paths. Configure edge request limits; the application does not trust arbitrary forwarded client addresses. Anonymous static readers do not consume the management authentication rate-limit quota.

If Caddy inherits an outbound HTTP proxy, append the local Compose hostname `docs` to its existing `NO_PROXY` and `no_proxy` values. Preserve the other entries and outbound proxy/CA settings. This keeps the local upstream on the frontend network while retaining the configured egress path for external requests.

The cloud proxy's optional build CA is supported through `deploy/compose.cloud.yaml` and a BuildKit secret; it is not copied into the runtime image. Ordinary deployments should use the primary Compose file. Never disable certificate verification to build an image.

For a destination without registry/npm access, follow [offline application installation](offline-installation.md). It mirrors reviewed image IDs and the small operator file set, verifies transfer checksums and starts Compose with `--no-build --pull never`. Host tools and production TLS trust are supplied through the operator's approved mirror.

## Stop or restart

Compose gives the server 45 seconds after SIGTERM before forcing termination. Its executable defaults to a 30-second shutdown budget (`SHUTDOWN_TIMEOUT_MS`), drains active responses and then closes database pools. Stop/restart only the intended service, for example `docker compose -f deploy/compose.yaml stop docs`; this does not stop PostgreSQL or remove volumes. A controlled restart uses `docker compose -f deploy/compose.yaml restart docs` and must be followed by readiness and reader checks.

Keep the supervisor grace period above any overridden application deadline. The Kubernetes template likewise sets `terminationGracePeriodSeconds: 45`; actual ingress draining and cluster rollout/recovery still require topology-specific acceptance. A nonzero exit or shutdown-deadline log requires investigation. Verify publication history and reuse the original idempotency key when retrying an interrupted publication. See [process shutdown behavior](server.md#process-shutdown).

## Backup

Pause publication and artifact staging writers for the operation. Readers can remain online. Do not run artifact cleanup concurrently. The database dump is taken first, followed by the immutable artifact tree. Recovery sets include private documentation, scoped token hashes and audit history; encrypt and restrict them as sensitive data. Browser sessions and pending OIDC exchanges are intentionally excluded.

```sh
# Keep PUBLIC_URL and the source deployment's secret configuration set.
export COMPOSE_PROJECT_NAME=doctopus
node scripts/recovery.mjs backup /secure-backups/doctopus-2026-10-22 --writers-paused
```

The destination must not exist. A successful set contains `database.dump`, `artifacts.tar` and `recovery.json` with SHA-256 checksums. An `.incomplete` marker means the backup failed. Move completed sets to encrypted off-host storage, retain the matching application image and deployment configuration, and test recovery regularly. Checksums detect corruption; they do not authenticate a backup from an untrusted source. Treat recovery sets as privileged deployable content.

## Restore rehearsal and disaster recovery

When the deployment selects images through an additional Compose file, pass `--compose-override FILE` after `--writers-paused` to both recovery commands. The CLI inserts that file before its writable recovery override, preserving the normal read-only application mount. The selected file must be regular, unlinked and at most 1 MiB. Keep it with the compatible images and backup; review it as privileged operator configuration. See the [offline recovery example](offline-installation.md#install-on-a-fresh-destination).

Restore into a **new Compose project with fresh volumes**, never over the live deployment. Use the same compatible application image and PostgreSQL major version. Generate a separate secret directory for the new database roles; retain the old root token only if your incident policy permits it. A new root token invalidates old operator sessions. Scoped tokens retain their existing hashes and revocations.

```sh
node scripts/init-deployment.mjs deploy/.secrets/recovery
export COMPOSE_PROJECT_NAME=doctopus-recovery
export DOCS_SECRETS_DIR=.secrets/recovery
export PUBLIC_URL=http://127.0.0.1:8087
export DOCS_PORT=8087
export INSECURE_DEVELOPMENT=true
node scripts/recovery.mjs restore /secure-backups/doctopus-2026-10-22 --writers-paused
docker compose -f deploy/compose.yaml up -d --no-build --wait
```

The script checks backup hashes, refuses a database with existing public tables or a nonempty artifact volume, verifies every restored publication, restores the schema as its owner in one database transaction, and reapplies runtime grants. The writable artifact override is used only for the temporary recovery helper. If recovery fails, keep the failed environment for diagnosis and retry into another fresh project; the script does not erase or repair existing volumes.

Verify readiness, public pages, private page/search denial, authenticated access, publication history and audit records before exposing traffic. Apply a production HTTPS origin and TLS proxy before switching DNS. Measure and record your own recovery time and recovery point objectives. Application rollback can activate a retained previous artifact; database schema rollback requires a compatible recovery set and cannot be achieved by merely starting an older container.

A schema rollback restores the backup's point in time. Writes after that recovery point are not retained. Keep writers paused during the upgrade decision window or use a separately tested reconciliation procedure before moving traffic back.

## Kubernetes template

`deploy/kubernetes.yaml` is a starting template, not a turnkey managed cluster installer. Supply a `ConfigMap` named `doctopus` with `public-url`, a `Secret` named `doctopus` with `database-url` (runtime role) and `root-token`, and a PVC named `doctopus-artifacts`. Provision PostgreSQL and run the migration job separately with the owner connection and `DB_RUNTIME_ROLE`. Replace `doctopus:local` with your reviewed registry image digest. Configure a TLS Ingress, encrypted storage, backup jobs and network policies according to the cluster's provider. The current template uses one replica and a Recreate rollout; shared multi-replica storage and cluster recovery remain unvalidated release gates.

## Publication verification boundaries

Compiler output, CLI staging, Node adapters and the management server share manifest validation. New publications use the portable version 2 identity; Node retains legacy version 1 verification, while Java requires a rebuilt version 2 artifact. Metadata must have valid SHA-256 identities, canonical relative file paths without traversal/hidden segments, valid routes, and typed diagnostic/plugin records. Manifest reads are bounded to 16 MiB before JSON parsing. Metadata limits are 200,000 files, 100,000 routes, 10,000 diagnostics and 32 plugins; the byte limit can be reached sooner. See the [manifest protocol and migration](artifact-manifest.md).

Node verification hashes small payload files with a bounded buffer of at most 1 MiB plus a growth sentinel; larger files use 64 KiB chunks. A size change or checksum mismatch fails verification. Node source/manifest/payload reads require regular files; POSIX nonblocking opens reject named pipes rather than waiting for a writer. Build output cannot contain symlinks or special files. Java also validates regular manifest inputs, confines listed payload paths and streams payload checksums.

Artifacts must remain immutable after staging. These checks establish content integrity; publisher authentication and protected deployment/release procedures establish who may activate it. Keep generated static roots free of unrelated files. The standalone preview server serves its generated directory; immutable staged server publications additionally enforce the verified manifest's file allowlist on reader requests.

## Disposable server-container acceptance

Build the default server target and test its immutable image with a local Linux Docker daemon and cgroup v2. Cache the exact PostgreSQL digest from `deploy/compose.yaml` first. A full Git checkout is required to build the recorded historical upgrade baseline. Run from the repository root after `npm ci --ignore-scripts && npm run build`:

```sh
docker build --target server --iidfile /tmp/doctopus-server.id .
mkdir -p .doctopus
node scripts/build-upgrade-baseline.mjs > .doctopus/upgrade-baseline-evidence.json
docker pull caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
SERVER_BASELINE_IMAGE="$(cat .doctopus/upgrade-baseline.id)" SERVER_TEST_IMAGE="$(cat /tmp/doctopus-server.id)" npm run test:server-container --silent
```

The harness uses the shipped Compose file with a unique project, fresh credentials, an unpublished loopback port and owned volumes/networks. It refuses external resource reuse and does not select an existing deployment. A fixture is compiled offline inside that exact server image, then published only to the disposable installation. Acceptance verifies schema/runtime role grants, UID 1000, a read-only root, no capabilities, seccomp, no new privileges and explicit test limits (512 MiB, two CPUs, 128 PIDs). These limits are test overrides; choose production capacity for your workload.

It checks private HTML, page/site data, search catalog/shards and browser assets after authorized access, viewer-token revocation, restart persistence and publication idempotence. PostgreSQL is stopped deliberately: readiness and private content must return 503 without content leakage while liveness stays available. Restarting PostgreSQL must restore the same publication. The harness removes only its owned containers, networks, volumes and temporary files, verifies cleanup, and prints a JSON receipt on success. It never receives production credentials. This covers a single-host installation, outage recovery, verified Caddy HTTPS and the fresh-target restore rehearsal below; external certificate issuance, site-specific ingress and multi-replica acceptance remain separate.

Both normal quality and prepared-version release rehearsal run this acceptance and retain the receipt. The rehearsal also checks that the running server reports the prepared tool version and matches the selected image ID. Follow the managed environment's proxy/CA setup when building behind a TLS-intercepting proxy; TLS verification must stay enabled.

### Automated HTTPS proxy rehearsal

The fixture starts the digest-pinned Caddy 2.11.7 image with the actual `deploy/Caddyfile`, adding a fixture-only private CA and disabling public certificate issuance, trust-store installation and the admin listener. Only a loopback TLS port is published. The application is recreated with an HTTPS `PUBLIC_URL` and insecure development disabled, using the same tested image and publication. Native HTTPS clients verify the fixture's public CA and `localhost` certificate name; an untrusted client must reject the chain. Certificate verification is never disabled.

The receipt records the negotiated TLS protocol (1.2 or 1.3). Eight checks cover certificate verification, Secure/HttpOnly/SameSite cookies, HSTS/security headers, exact private HTML and protected data/search/assets after an authenticated cache warm, missing/wrong mutation origins, forwarded-header spoofing, and session revocation after same-origin logout. Caddy uses UID 1000, a read-only root, no new privileges, bounded resources and only `NET_BIND_SERVICE`: its official executable carries that file capability even when listening on port 8443. The application retains its separate zero-capability checks. Existing proxy settings are preserved with only the local upstream added to `NO_PROXY`.

The proxy is removed by its unique fixture label and verified container name. The owned application is stopped/removed before each replacement to bound Docker VFS storage use, then restored to its original fixture settings before backup/restore runs. Reports bind the server image/artifact, pinned proxy image, exact shipped template checksum, certificate fingerprint, TLS version, eight private file paths and verified cleanup. Prepared rehearsal requires that receipt and checks the current template bytes. This exercises a private test authority, not ACME/DNS ownership, public certificate renewal, OIDC provider availability or a fully air-gapped installation.

### Automated fresh-target restore rehearsal

The same container acceptance command also runs `scripts/recovery.mjs` against its owned fixture. It backs up the private publication, validates recovery checksums and directory permissions, and then stops/removes that source before creating a different fresh project with new database/operator secrets. The target restores into the supported named artifact volume using the same selected image. Source and target are sequential, avoiding shared resources and excessive Docker storage use.

Before restoration, incomplete/corrupt sets must fail without creating target containers. After restoration, exact published HTML, private HTML/data/search/asset denial, active and revoked scoped tokens, rotated operator credentials, append-only runtime grants, audit history and publication idempotence must match expectations. The fixture creates a browser session through the API and seeds a pending OIDC record before backup; both tables must be empty after restoration while the scoped token remains usable. A restore into the populated target must refuse without changing served bytes.

Both source and target cleanup are checked before the JSON receipt reports success. The prepared release gate requires at least nine recovery checks, the selected server image, matching artifact identity and verified target cleanup. No existing deployment, external volume or production credential is selected. This exercises a small single-host fixture with cached images; site-specific recovery time/point objectives, major PostgreSQL upgrades, encrypted off-host storage and full air-gapped installation remain operator acceptance work.

Hosted [Quality 40002181064](https://github.com/DavidNiessen/doctopus/actions/runs/40002181064) and [release rehearsal 40003175317](https://github.com/DavidNiessen/doctopus/actions/runs/40003175317) passed every required job at `3f6cb48`. The prepared `0.2.0` image `sha256:18902b0cbff8e2ab23803ed3c28009bc00bade4e276764130731f12e2428514e` passed the same source/target image and artifact checks, nine recovery checks and both cleanup checks. The restored fixture artifact was `6e8eee1229e2e7424d8e85e5446c8eb4b2c433a407ad97a07aa5d7e4c709b607`. This is recorded single-host rehearsal evidence, not a signed or approved release.

### Automated schema upgrade and rollback rehearsal

The baseline builder exports historical commit `ff2c87f874357792fb9ac575f8002e9e88d0f94e` from local Git history and builds its original server Dockerfile and lockfile, retaining the immutable image ID and source label. It never downloads a mutable source branch or changes the current checkout's prepared version. This is a pre-release schema-1 compatibility fixture, not a supported public release. Its old dependencies are used only in disposable local acceptance.

Container acceptance starts that actual older server in a separate owned Compose project and publishes the current verified artifact privately. It creates a scoped viewer token and editor role, hashes all durable schema-1 project/role/artifact/publication/token/audit rows and invokes the real backup CLI. The new runtime must refuse the unmigrated database. A deliberately conflicting queue table makes the new migration fail; its transaction must retain schema 1, all prior rows and no partially created source table.

After the conflict is removed, the matching migration must apply schema 2, preserve every recorded row and grant queue access while retaining append-only audit and read-only migration history. The new server must serve the same private files and publication idempotently. The old executable must refuse schema 2. Finally, the original deployment is removed and its pre-upgrade recovery set is restored into a different fresh project with the older image and new secrets. The old runtime must then serve the same publication and scoped token on schema 1; the old root credential must fail.

The ten-check receipt binds both image IDs, the historical source commit, artifact, metadata checksum, recovery-file checksums, schema sequence and private-file coverage. Cleanup of both projects is required. Quality and prepared release rehearsal build the baseline independently and require the result. This exercises the first schema transition on PostgreSQL 17; it does not validate PostgreSQL major upgrades, arbitrary older versions, live traffic migration, multi-replica operation or the site's recovery objectives. Production operators must retain a tested compatible image and pre-upgrade recovery set, pause writers and verify a fresh rollback before switching traffic.
