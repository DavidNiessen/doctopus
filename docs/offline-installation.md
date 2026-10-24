# Offline application installation

The server can start and publish documentation from mirrored Docker images and deployment files. Prepare Docker Engine/Compose, Node.js 24 and standard Linux archive/checksum tools through your host's approved mirror. Supply production TLS termination and its certificate lifecycle separately. The project is pre-release; use an internally reviewed build while signed public distributions remain a launch gate.

## Prepare the mirror on a connected build host

Build and test the server image from your reviewed checkout. Export its immutable image ID as `DOCS_IMAGE`; the container acceptance command in [deployment](deployment.md#disposable-server-container-acceptance) records the exact tested image. Cache the pinned PostgreSQL image from `deploy/compose.yaml` on this host.

The following block requires a fresh directory and stops on any error. It copies the operator files, generates an override from the reviewed image IDs, exports the images and records the complete transfer set's checksums:

```sh
(
set -eu
mkdir -p .doctopus
mkdir .doctopus/offline-mirror
mkdir .doctopus/offline-mirror/deploy .doctopus/offline-mirror/scripts
cp deploy/compose.yaml deploy/compose.restore.yaml deploy/init-database.sh deploy/Caddyfile .doctopus/offline-mirror/deploy/
cp scripts/init-deployment.mjs scripts/recovery.mjs .doctopus/offline-mirror/scripts/
cp LICENSE NOTICE .doctopus/offline-mirror/
export OFFLINE_DATABASE_IMAGE="$(docker image inspect postgres:17-alpine@sha256:1bcc18d81671b02906296aad470ec9778a6b71016ce953092024b680bad007b0 --format '{{.Id}}')"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const server = process.env.DOCS_IMAGE;
const database = process.env.OFFLINE_DATABASE_IMAGE;
for (const image of [server, database]) assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
const service = (image) => ({ image, pull_policy: 'never' });
await writeFile('.doctopus/offline-mirror/deploy/compose.offline.json', JSON.stringify({
  services: { db: service(database), migrate: service(server), docs: service(server) },
}, null, 2) + '\n');
NODE
docker image save --output .doctopus/offline-mirror/images.tar "$DOCS_IMAGE" "$OFFLINE_DATABASE_IMAGE"
cd .doctopus/offline-mirror
sha256sum images.tar LICENSE NOTICE deploy/compose.yaml deploy/compose.restore.yaml deploy/compose.offline.json deploy/init-database.sh deploy/Caddyfile scripts/init-deployment.mjs scripts/recovery.mjs > SHA256SUMS
)
```

Saving both images by configuration ID avoids importing mutable repository tags on the destination. Repository digest lookups may be unavailable after archive import; the offline override selects the exact imported configuration IDs for all three services.

Retain the image inventory, source commit, release version and acceptance receipts with your approved mirror record. Transfer the directory through your approved channel. Checksums detect changed bytes; publisher authentication requires a trusted source and reviewed signatures/provenance. Deployment secrets are generated on the destination and never belong in this transfer set.

## Install on a fresh destination

From the transferred directory, verify every checksum before importing images or running the supplied scripts:

```sh
export COMPOSE_PROJECT_NAME=doctopus-offline
export PUBLIC_URL=https://docs.example.com
(
  set -eu
  sha256sum --check SHA256SUMS
  docker image load --input images.tar
  node scripts/init-deployment.mjs
  docker compose -f deploy/compose.yaml -f deploy/compose.offline.json up --detach --no-build --pull never --wait
)
```

Choose a new project name and an HTTPS origin owned by your installation. Use the same override for subsequent lifecycle operations. A missing image must fail instead of triggering a registry pull. The migration container initializes the schema and runtime grants; the application contains its own Node runtime and compiled assets. The two operator scripts above require only Node built-ins, so the destination performs no npm installation.

Configure the external TLS proxy using the [deployment guide](deployment.md). Air-gapped installations need locally available trust material and a certificate-renewal process compatible with their network policy. The standard Compose frontend supports loopback ingress; enforce site-specific Docker egress controls according to the host's isolation requirements. API playground requests originate from visitors' browsers unless the optional server relay is explicitly configured.

Use the copied recovery script with the matching image override for backup and fresh-target restoration:

```sh
node scripts/recovery.mjs backup /secure-backups/offline-docs --writers-paused --compose-override deploy/compose.offline.json
```

Pause writers first and follow the [fresh-target restore procedure](deployment.md#restore-rehearsal-and-disaster-recovery), supplying the same `--compose-override deploy/compose.offline.json` argument to `restore`. The CLI places its writable recovery configuration last, preserving the normal read-only application mount. It rejects linked, nonregular and oversized override files before changing deployment resources. Retain the same image IDs and PostgreSQL major version in the recovery mirror. Do not assume a database schema rollback follows an image change.

## Automated acceptance

`npm run test:server-container` exports the selected server and pinned PostgreSQL images by immutable ID. It verifies both archived configuration hashes, rejects mutable archive tags, detects an appended corrupt byte through the standard checksum command, restores/verifies the archive and imports it. Image IDs and existing tags must remain unchanged.

After the preceding lifecycle, HTTPS and fresh-target restore checks have cleaned their deployments, a different owned project starts the shipped Compose services from the imported image IDs with `--no-build --pull never`. Both application networks are internal and IPv6 is disabled; an in-container probe verifies the absence of a default route, UID 1000 and the expected tool version. Through loopback API calls it creates a private project, verifies/publishes the offline-built artifact, checks exact HTML plus protected data/search/assets and rejects anonymous access after an authenticated cache warm.

The eight-check receipt binds the archive checksum/size, server/database images, artifact, runtime version and private-file coverage. It additionally runs the actual backup CLI with the imported-image override and verifies both recovery-file checksums. The preceding fresh-target recovery rehearsal independently restores through an image override and verifies the selected database image. The large archive is removed after import verification, before allocating the new deployment, to bound disposable storage. Cleanup verifies the fixture's containers, networks and volumes are gone. Cached image IDs remain available to their existing consumers. This is Linux Docker application-startup evidence with preinstalled host tools; host provisioning, physical network isolation, public certificate renewal, third-party identity providers and other architectures need their own acceptance.
