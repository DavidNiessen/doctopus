# Separate build worker

The Linux worker consumes [approved build jobs](build-jobs.md) over authenticated HTTP, executes the existing restricted Docker runner and registers verified artifacts. It runs separately from the request server. Static documentation, CLI exports and framework integrations continue to work without PostgreSQL or a worker.

## Supported topology

Use a dedicated, patched Linux build host with the matching Node.js version, installed workspace tooling and an approved immutable `isolated-builder` image. The Docker daemon must support the [runner's observed controls](isolated-builds.md). Docker socket access grants administrative control of the host; keep it and the operator credential away from the request server and source containers.

The first supported worker topology uses operator-prepared local sources and filesystem artifact storage. The worker and request server must see the same immutable artifact bytes, with the worker able to stage artifacts and the server able to read them. Configure matching artifact roots or equivalent shared mounts. No source download/upload service, remote artifact-transfer protocol or automatic dependency installation is provided.

## Approve and prepare input

1. Put reviewed, secret-free documentation input in a dedicated local directory. Keep visible input immutable for the approval's lifetime; `.doctopus` must remain writable for worker output. Hidden entries and `node_modules` are excluded from execution snapshots. Visible files are readable by approved build code.
2. Inspect with `node packages/cli/dist/main.js source-info /srv/docs-source --json`. Copy its `source` metadata into the source approval. Configuration parsing, plugins and MDX are not executed by inspection.
3. Approve the exact project, snapshot and full executable policy through `POST /api/projects/:project/build-sources`. Review the image digest, visible config path, trust flags and resource limits. The project must build with the literal `basePath: /docs/<project-slug>` required by the management server.
4. Put the returned source UUID, project UUID, canonical local directory, snapshot and identical normalized policy in the worker's independent registry. Changing a database approval cannot choose a host path or enable new trust/resource settings.

Inspect, approve and deploy a new registry entry when source or policy changes. Revoking the previous approval cancels unfinished work. A worker reads configuration at startup; restart it to load registry changes. Keep sources separately backed up if retries must survive host loss; artifact/database backups do not include them.

## Configure and start

The worker reads strict data-only JSON, bounded to 4 MiB. This example illustrates the shape; replace the example UUIDs, image/digest, counts and paths with the actual approved values:

```json
{
  "schemaVersion": 1,
  "serverUrl": "https://docs.example.com",
  "workerId": "build-host-1",
  "artifactRoot": "/srv/doctopus/artifacts",
  "maxConcurrency": 1,
  "maxMemoryMiB": 2048,
  "maxCpus": 2,
  "pollMs": 2000,
  "sources": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "projectId": "11111111-1111-4111-8111-111111111111",
      "directory": "/srv/docs-source",
      "snapshot": {
        "digestVersion": 2,
        "digest": "0000000000000000000000000000000000000000000000000000000000000000",
        "bytes": 1000,
        "files": 2
      },
      "policy": {
        "image": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "config": "docs.config.yaml",
        "trustPlugins": false,
        "trustContent": false,
        "limits": {
          "timeoutMs": 180000,
          "memoryMiB": 2048,
          "cpus": 2,
          "pids": 128,
          "sourceMiB": 128,
          "outputMiB": 256
        }
      }
    }
  ]
}
```

Control configuration and the operator credential file must resolve outside every prepared source and outside artifact storage. Sources and artifact storage cannot contain one another. Paths must be absolute and are canonicalized before claiming work. Unknown fields, duplicate approval IDs, empty registries, invalid policies and sources exceeding host/policy budgets fail startup. There may be 1–1000 prepared sources.

Build the checkout, provision the JSON and a protected credential file, then run:

```sh
npm run build
BUILD_WORKER_CONFIG_FILE=/etc/doctopus/worker.json \
ROOT_TOKEN_FILE=/etc/doctopus/operator-token \
npm run worker
```

`ROOT_TOKEN` is an alternative to `ROOT_TOKEN_FILE`. The file takes precedence. The current protocol uses the existing full operator identity, which can administer the server; a narrower worker identity remains future work. Use a dedicated protected host and TLS. Never place this credential in project input, worker JSON, reader state or source-container environment. Control-plane credentials stay in the HTTP client and are not passed to the source executor.

`serverUrl` must be an HTTPS origin without a path, credentials, query or fragment. Explicit `insecureDevelopment: true` additionally allows `http://localhost` or `http://127.0.0.1` for local fixtures. Redirects and cookies are not followed or forwarded. Control responses have JSON, byte and deadline checks; rejected authentication stops the worker.

## Capacity and polling

| Setting          | Default | Range         |
| ---------------- | ------- | ------------- |
| `maxConcurrency` | 1       | 1–4           |
| `maxMemoryMiB`   | 2048    | 512–16384     |
| `maxCpus`        | 2       | 1–16          |
| `pollMs`         | 2000 ms | 1000–30000 ms |

The worker claims at most one local job per source approval at a time and sums active CPU/memory reservations before offering eligible sources. Independent database admission still applies. Storage checks reserve source plus twice output budgets for active jobs, the next build's source/output budgets and 64 MiB headroom on both source and artifact filesystems. These checks do not reserve or measure Docker's separate image/container storage. Monitor all relevant disks and reserve room for the daemon, database and other services.

Idle or unavailable control planes use exponential polling backoff capped at 30 seconds. Activity returns to the configured polling interval. Heartbeats renew every ten seconds, independently of polling. The server has a separate 1200-per-minute/IP allowance for valid root-bearer worker routes; management keeps 300 and protected reader traffic keeps 12000. Rejected authentication counts against management before token lookups. These limits are per server process; use infrastructure admission controls for a distributed deployment.

## Failure, shutdown and recovery

Ownership is renewed before source execution. Changed source/policy, cancellation, revocation, lost or uncertain heartbeat ownership aborts execution. The runner verifies the approved source digest before importing build code. A unique job/attempt directory contains its lock, frozen source snapshot, export staging and output. Ordinary completion/cancellation removes it. Each attempt records its process PID and kernel start time, boot ID, PID namespace and a monotonic recovery window covering its build budget plus 120 seconds.

Before storage admission, the worker inspects at most 100 workspace entries per source, at most once per minute. It reclaims expired work only when the recorded process is proven dead in the same boot and PID namespace. Live owners remain protected even after expiry, and reused PIDs are distinguished by their start time. Reclamation is confined to the named job/attempt directories. It honors shutdown and checks directory identity again before removal.

Unknown, malformed, linked or unreadable ownership is retained for operator inspection, as is work from a different boot or PID namespace. Older unmarked directories and interrupted pre-watchdog Docker allocations also need operator review. Inspect ownership and Docker labels before removing specific abandoned paths or resources; never remove a live build lock.

Successful builds are verified and staged under their immutable digest before completion. The HTTP server independently hashes their bytes, checks project/tool identity and performs atomic lease/result registration. Success never activates a publication. Publish through the existing authorized publication flow with its expected-pointer check.

Completion retries a lost acknowledgement up to three times with bounded backoff. Identical settlement is idempotent; uncertain outcomes are left for inspection/recovery. Fixed `source_changed`, `deadline_exceeded` and `build_failed` codes describe terminal failures. Event output contains event names and job IDs, without raw credentials, source paths or arbitrary source logs.

SIGTERM/SIGINT abort active runners and wait for cleanup, with a 90-second process deadline. Configure a service manager with at least that shutdown grace. A deployment stop does not mark otherwise valid source as a permanent failure; its lease expires and recovery waits until the old hard deadline. Independent runner watchdogs own container cleanup after process death. Never shorten that deadline or force a second owner while the old execution budget is open.

## Acceptance

```sh
TEST_DATABASE_URL=postgresql://fixture-host/disposable-database \
ISOLATED_BUILD_IMAGE=sha256:approved-immutable-builder-id \
npm run test:build-worker
```

Use a disposable schema-owner database, matching compiled packages and an actual Linux Docker daemon. The harness uses real HTTP source approvals/enqueues, worker claims/renewals, Docker builds and artifact completion. It checks native output parity, unchanged publication state, changed-source rejection, real cancellation, workspace cleanup, killing the actual worker executable, independent watchdog cleanup, expired workspace/lock reclamation and second-attempt recovery. Recovery waits the real 135-second hard deadline for the fixture policy; it does not change PostgreSQL clocks or shorten ownership budgets. The required CI isolation job builds its own worker image and runs both isolated-runner and worker/API acceptance, retaining receipts.

The PostgreSQL/HTTP suite also checks revoked ownership, independently changed local approval, lost completion acknowledgements and executable file-credential startup/shutdown. Registry/protocol/unit cases cover strict data and URL boundaries, resource admission, bounded idle backoff, controlled failure handling and independent rate-limit budgets. Workspace cases cover active/reused process IDs, boot/namespace boundaries, malformed/oversized ownership, link refusal, nested-link target preservation, bounded sweep progress and shutdown. The fresh-image isolation/worker job passed in [hosted quality run 39983896039](https://github.com/DavidNiessen/doctopus/actions/runs/39983896039) at `6f1e5ce`. Expanded [release rehearsal 39987857551](https://github.com/DavidNiessen/doctopus/actions/runs/39987857551) additionally passed these harnesses with prepared tool version `0.2.0` at source `05a0fa9`, validating nonempty receipts against the prepared version and exact built image. Signed worker distribution, dedicated-host hardening and independent isolation review remain release gates.
