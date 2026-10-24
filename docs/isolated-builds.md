# Isolated documentation builds

`doctopus isolated-build` is an operator-only, offline build runner for Linux Docker Engine. It stages data on the operator host, executes the compiler and explicitly trusted plugins/MDX in a separate restricted container, verifies the exported publication and activates it under the normal publication lock. The application server does not accept source uploads or invoke this runner. Keep Docker access off the application server.

## Prepare an approved worker

Build the worker from the reviewed checkout and locked dependencies. The default Docker target remains the publication server; select `isolated-builder` explicitly. Use the same CLI version and compiled reader assets on the host and in the image.

```sh
npm ci --ignore-scripts
npm run build
docker build --target isolated-builder --iidfile /tmp/doctopus-builder.id .
node packages/cli/dist/main.js isolated-build /srv/docs-source \
  --image "$(cat /tmp/doctopus-builder.id)" --json
```

Networked image builds must use your configured registry credentials, proxy and verified CA trust. The Dockerfile accepts an optional `proxy_ca` build secret for npm. The documentation job itself is offline. Images must already exist locally; mutable tags and automatic pulls are rejected. Repository digests and full `sha256:` image IDs are accepted. An image digest records identity, not publisher trust: the operator must approve the image and its dependencies first.

The local Docker daemon must support cgroup v2, the default seccomp filter, private cgroup namespaces, the freezer and managed local-driver tmpfs volumes. The runner probes the requested limits before executing source; missing enforcement fails the build. Remote Docker endpoints and non-Linux hosts are unsupported. `--socket` selects a local Unix socket; inherited Docker endpoint/TLS selectors cannot redirect the job. Docker registry configuration is preserved.

## Inspect and approve source

```sh
doctopus source-info /srv/docs-source --json
# Set DOCS_APPROVED_SOURCE_DIGEST from the reviewed source inspection,
# and DOCS_APPROVED_WORKER_IMAGE to the approved immutable worker image.
doctopus isolated-build /srv/docs-source --image "$DOCS_APPROVED_WORKER_IMAGE" \
  --source-digest "$DOCS_APPROVED_SOURCE_DIGEST" --json
```

`source-info` copies a bounded visible snapshot into a private temporary directory, computes its metadata, and removes the copy. It does not parse project configuration, import project code, install dependencies, require Docker, or change the project's publication. `--source-mib` sets the same 1–1024 MiB budget as the runner, default 128. The JSON envelope is `{ "schemaVersion": 1, "source": { "digestVersion": 2, "digest": "…", "bytes": 0, "files": 0 } }`; actual counts depend on the source.

The approval binds visible file paths and bytes plus directory layout, including empty directories. Hidden entries and `node_modules` remain excluded at every level. Snapshot file/directory permissions are normalized as before. Digest version 2 hashes UTF-8 compact JSON with `version`, `files` and `directories` in that order: `version` is 2; `files` is the sorted array of `{path,digest}` file records with SHA-256 content digests; `directories` is the sorted array of visible relative directory paths. Sorting follows JavaScript string ordering, independent of host locale. The digest excludes absolute paths and the runner's injected output scaffolding. Earlier unversioned receipt digests covered files only; obtain a fresh version 2 inspection for new approvals.

`--source-digest` / `expectedSourceDigest` accepts a lowercase 64-character SHA-256 value. After staging the actual build snapshot, the host compares its digest **before any Docker command or source execution**. A mismatch retains the prior publication and cleans the private stage/lock. A matching pin continues the existing immutable-image, isolation and publication checks. The executed read-only snapshot is the one that was compared, so later changes to the original source affect a later job. Bind approved image, config path, trust flags and resource policy separately when scheduling a build; a source digest alone does not approve those choices.

The public `@davidniessen/doctopus-cli` API exports `inspectIsolatedSource`, `IsolatedSourceOptions` and `IsolatedSourceInfo` alongside `buildIsolatedSite`, `IsolatedBuildOptions` and `IsolatedBuildReceipt`. Both inspection and building accept an `AbortSignal`. A build receipt's source metadata uses the same digest version and counts as inspection of the identical source. Inspection is data-only; validate the project separately with `validate` or `doctor` before approving it.

## Source and dependency boundary

Supply a dedicated, secret-free documentation source directory. All hidden entries and `node_modules` are excluded, including `.env`, `.git`, `.npmrc`, deployment secrets and previous `.doctopus` output. This is an exclusion rule, not secret detection: **visible files supplied in the source remain readable by build code**. Do not point this at a credentials directory or a general application checkout containing private data.

The snapshot accepts single-link regular files and directories; symlinks, hardlinks and special files fail. It caps traversal at 30,000 entries and individual files at 64 MiB. It copies source data without executing package scripts. Config paths must be visible, relative and confined to this snapshot. Source changes after staging affect a later job.

The worker provides the product's installed packages through `/work/node_modules`. Bundle additional reviewed dependencies into a separately approved worker image at that location. There is no dependency installation, source checkout, remote spec import or remote reference resolution during the job. Import a verified local spec snapshot first. `--trust-plugins` and `--trust-content` remain explicit execution opt-ins; container separation does not remove them.

## Runtime limits and publication

| Option         | Default | Accepted range     |
| -------------- | ------- | ------------------ |
| `--timeout-ms` | 180000  | 1000–900000        |
| `--memory-mib` | 2048    | 512–4096           |
| `--cpus`       | 2       | 1–4, whole numbers |
| `--pids`       | 128     | 32–512             |
| `--source-mib` | 128     | 1–1024             |
| `--output-mib` | 256     | 32–1024            |

Containers run as UID/GID 1000 with no network, dropped capabilities, no new privileges, a read-only root and source mount, no restart policy, no Docker log capture, and bounded memory/CPU/processes. Swap is disabled. Temporary storage is a 64 MiB tmpfs; the separate managed output tmpfs has the requested capacity and a 60,000-inode cap. Both are mounted `nosuid,nodev,noexec`. Host environment variables and credentials are not forwarded. Docker's default proxy variables are explicitly blanked for this offline job.

After compilation, Docker freezes every container process, including detached descendants. The host streams the output archive into its own private staging directory. It creates only bounded regular files/directories, rejecting traversal, duplicate paths, links, special files, compression, truncated archives and byte/count overruns. Files are limited to 64 MiB each and 50,000 entries. Archive modes and ownership are ignored. Publication hashes, compiler version, inventory, site data and configuration are checked before activation. This establishes structural integrity, not the trustworthiness of the documentation's author.

The runner removes the container and its output volume before activation. Failures, deadlines and cancellation preserve the prior publication. `--output` uses the normal project `.doctopus` confinement and `.build.lock`. The JSON receipt records the immutable image, source digest/count/bytes, artifact identity, duration, limits and observed controls; it excludes source paths, credentials and source logs. Receipts are local evidence, not signed provenance.

## Cancellation and recovery

SIGINT/SIGTERM and the JavaScript API's `AbortSignal` cancel the job. An independent host watchdog removes its immutable container ID and owned output volume after parent death or the deadline. Cleanup retries bounded daemon failures. A permanently unavailable daemon still requires operator recovery; inspect only the affected job's `io.doctopus.isolated-job` label and its `doctopus-build-<uuid>` volume when service returns. Do not prune unrelated containers or volumes.

A killed operator process can leave its private `.doctopus/isolated-<uuid>` staging directory and `.build.lock`. Confirm the corresponding container/volume are gone and no other build is active before removing those specific leftovers. Never delete a surviving `previous-<uuid>` backup until the publication has been recovered and verified. The runner does not silently break publication locks.

Temporary snapshots, export staging and previous-output directories live beside the selected output under `.doctopus`. Nested worker outputs therefore keep their temporary files inside the owning attempt directory. The [separate worker](build-worker.md#failure-shutdown-and-recovery) can reclaim proven-expired attempts after process death.

Interruption during allocation, before the watchdog is armed, can also leave an owned volume or stopped container. The workload starts only after the watchdog handshake. Inspect the affected labels and remove those specific resources during recovery.

Docker access is privileged administrative access to the host. Use a dedicated patched build host, controlled socket access and approved images. Container/kernel isolation is not a VM boundary or a guarantee against kernel vulnerabilities. Host disk capacity, daemon availability, signed worker distribution and deployment-specific hardening remain operator responsibilities.

## Validation

```sh
ISOLATED_BUILD_IMAGE="$(cat /tmp/doctopus-builder.id)" npm run test:isolated-builds
```

The serial harness checks pinned-source/native/isolated artifact parity, receipt identity, mismatched-source rejection, SDK plugin resolution, absent host markers, read-only mounts, offline interfaces, detached descendants, trust refusal, deadline/cancellation, parent-death cleanup and preservation of the prior publication. Archive/snapshot adversarial cases also run in the normal unit suite. CI builds its own worker and makes this harness part of the aggregate quality gate.
