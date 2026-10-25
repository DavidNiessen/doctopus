# Installation and usage guide

For an existing Spring Boot, Express or Fastify application, start with the [direct integration quickstart](direct-integrations.md): configure a specification URL and runtime branding, then start your application. **That setup needs no `docs.config.yaml`, documentation build or publication directory.**

This guide also covers the optional standalone/static site workflow and management platform. Those features use a build project with a YAML/JSON configuration. Choose the path that fits your application before following the source-build and publication steps.

**Current installation path:** build Doctopus from source. The renamed npm/Maven packages and container coordinates are not yet published. The [GitHub Packages guide](github-packages.md) distinguishes future coordinates from the [previously published prerelease](archive/0.2.0-candidate.7-installation.md). A version in this repository does not establish registry availability.

## Contents

- [Choose your setup](#choose-your-setup)
- [Install the tools](#install-the-tools)
- [Create your first documentation project](#create-your-first-documentation-project)
- [Use the Reader and connect a real API](#use-the-reader-and-connect-a-real-api)
- [Write guides and customize the site](#write-guides-and-customize-the-site)
- [Deploy a static publication](#deploy-a-static-publication)
- [Integrate with Spring Boot](#integrate-with-spring-boot)
- [Integrate with Express or Fastify](#integrate-with-express-or-fastify)
- [Install Server and Studio](#install-server-and-studio)
- [Add automated builds with a Worker](#add-automated-builds-with-a-worker)
- [Validate, update and maintain the installation](#validate-update-and-maintain-the-installation)
- [Troubleshooting](#troubleshooting)

## Choose your setup

| Goal                                              | Install or run                                         | Database needed? |
| ------------------------------------------------- | ------------------------------------------------------ | ---------------- |
| Publish guides and an API reference               | CLI at build time; any suitable static host at runtime | No               |
| Add docs to an existing Spring Boot application   | Spring starter with a spec URL; optional prebuilt site | No               |
| Add docs to Express or Fastify                    | Node adapter with a spec URL; optional prebuilt site   | No               |
| Manage multiple projects, access and publications | Server, Studio, PostgreSQL and artifact storage        | Yes              |
| Execute queued builds from Studio                 | The management platform plus a separate Linux Worker   | Yes              |

For direct integrations, the flow is **dependency + specification URL + application settings → start the application → Reader loads the specification**. Your application or an existing OpenAPI generator supplies the document.

For optional static publications, the flow is **OpenAPI YAML/JSON + guides + project configuration → CLI build → static publication → Reader**. The framework adapters can also serve that prebuilt publication when selected explicitly.

The source/static-build sections below use Git and Node.js. A consuming Java application using bundled direct-mode artifacts does not need Node. Neither direct integration needs centralized administration.

## Install the tools

Commands use a POSIX shell, such as Bash on Linux/macOS or WSL. Keep the exported variables in the same shell while following a section. Use a second terminal when a preview or application server occupies the first one.

Install Git and the Node.js version in [`.node-version`](../.node-version), currently **24.22.1**. Then install the pinned package manager:

```sh
node --version
npm install --global pnpm@11.25.0
pnpm --version
```

Clone and build the workspace:

```sh
git clone https://github.com/DavidNiessen/doctopus.git
cd doctopus
export DOCTOPUS_REPO="$(pwd)"
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
```

The build produces the CLI, shared packages, Reader assets and Studio assets. It does not start an API server or create a database. These instructions invoke the compiled CLI directly, so they do not depend on a globally installed `doctopus` executable.

For a quick look at the supplied example:

```sh
pnpm run demo:build
pnpm run demo:serve
```

Open **[http://127.0.0.1:3000/](http://127.0.0.1:3000/)**. The ordinary example has live requests; run `pnpm run demo:api` from the repository root in another terminal for its local API. To explore a complete mock-only site instead, use the [public demo](https://doctopus.niessen.dev/) or the [local Pages demo instructions](pages-demo.md#build-and-preview-locally).

Press Ctrl+C to stop the example before continuing with another server on the same port.

## Create your first documentation project

Create a sibling project so your API documentation stays separate from the Doctopus tool checkout:

```sh
export DOCS_PROJECT="$DOCTOPUS_REPO/../my-docs"
node "$DOCTOPUS_REPO/packages/cli/dist/main.js" init "$DOCS_PROJECT"
```

The command creates:

```text
my-docs/
  docs.config.yaml
  openapi.yaml
  guides/
    introduction.md
```

It refuses to overwrite existing files. Keep your specification, guides, configuration and public source assets in your own version control. Add generated `.doctopus/` output to that project's `.gitignore` unless your deployment deliberately versions generated files.

### Configure the first site

Replace `my-docs/docs.config.yaml` with:

```yaml
schemaVersion: 1
name: My API
description: Guides and API reference for my application.
basePath: /docs
guides: guides
specs:
  - id: api
    path: openapi.yaml
    version: v1
theme:
  preset: violet
explorer:
  mode: mock
```

The generated `openapi.yaml` is a working OpenAPI 3.1 example with a health endpoint. Keep it for the first build, then replace it with your API's YAML or JSON document. For JSON, save `openapi.json` and change `specs[0].path` accordingly. Paths are relative to the documentation project.

`id` and `version` form the API reference routes. Multiple entries can describe different APIs or versions. The supported OpenAPI versions, references and limits are documented in [OpenAPI compatibility](openapi-compatibility.md).

### Validate, build and preview

```sh
node "$DOCTOPUS_REPO/packages/cli/dist/main.js" validate "$DOCS_PROJECT"
node "$DOCTOPUS_REPO/packages/cli/dist/main.js" build "$DOCS_PROJECT"
node "$DOCTOPUS_REPO/packages/cli/dist/main.js" serve \
  "$DOCS_PROJECT/.doctopus/site" --port 3000
```

Open **[http://127.0.0.1:3000/docs/](http://127.0.0.1:3000/docs/)**. You should see your introduction guide, API reference and Reader settings. Open an endpoint and choose **Try now → Send mock** to generate a local response without an API backend or credentials.

The generated publication is `my-docs/.doctopus/site/`. It contains HTML, scripts, styles, page data, search indexes and an integrity manifest. Edit the source files, not this generated directory.

### Preview edits while authoring

Stop `serve`, then run:

```sh
node "$DOCTOPUS_REPO/packages/cli/dist/main.js" dev "$DOCS_PROJECT" --port 3000
```

The development command watches inputs and rebuilds them. Refresh the browser after a rebuild. Restart it after changing `basePath`. Use a final `build` for a publication you intend to deploy.

## Use the Reader and connect a real API

The **All**, **API Reference** and **Documentation** tabs filter the modern navigation. Reader settings select appearance, a prepared theme and modern or classic layout. Classic mode uses an endpoint list and opens API Reference at the site root. Modern mode defaults to All. Search covers guides and endpoint documentation.

In the playground:

1. Review the resolved URL, which is read-only and can be copied in full.
2. Fill required path parameters and authentication inputs.
3. Edit documented query/header values, or add and remove custom parameters.
4. Use **Form** or **JSON** for the body. **Schema controls** within Form expose detailed field and array editing where supported.
5. Send the request. Inspect, fold, copy or expand the read-only response editor to fullscreen.

The checkbox beside a supported required text parameter means **Allow empty value**. It permits an explicitly empty value; it does not exclude a filled-in required parameter. Optional query/header inclusion controls can omit their values while retaining drafts.

### Switch from mocks to live requests

Set your real API origin and base path in the OpenAPI document, for example:

```yaml
servers:
  - url: https://api.example.com/v1
```

Replace that illustrative address with your API's actual URL, then change the documentation configuration:

```yaml
explorer:
  mode: live
```

Rebuild and reload the site. **Send request** now contacts the documented API. Cross-origin browser requests require that API to allow the documentation origin through CORS; required headers, methods and preflight requests must also be allowed. A successful command-line request alone does not establish browser CORS access.

Enter credentials in the playground. Copied snippets and displayed URLs use placeholders for credentials. Optional credential reuse is scoped and stays in memory. See [authentication](explorer-auth.md), [parameter serialization](request-serialization.md) and [request bodies](explorer-bodies.md).

Mock mode never sends the request to the API and ignores its request inputs when generating a response. Its **Mock response options** can select documented statuses/examples or generate supported schema data. In live mode, those explicit preview controls remain separate from sending a real request.

For deployments that need a server-side request transport, the optional management Server provides a separately configured [authenticated API relay](api-relay.md). Static hosting and framework adapters do not start that relay automatically.

## Write guides and customize the site

Add a file such as `guides/authentication.md`:

```markdown
---
title: Authentication
description: How to authenticate requests to this API.
group: Getting started
order: 20
---

## Create a credential

Describe how users obtain an API credential.

## Send a request

Open an endpoint's playground and enter the credential in Authorization.
```

Frontmatter controls page titles and navigation grouping. Markdown needs no execution flags. Reviewed MDX can use tabs, callouts, steps, cards and schemas with the separate `--trust-content` flag; see [guide authoring](authoring.md).

Publisher configuration controls the name, theme, navigation, logos, locales and canonical URLs. For example:

```yaml
name: My API
siteUrl: https://docs.example.com
basePath: /docs
theme:
  preset: violet
  density: comfortable
```

`siteUrl` is an HTTPS origin; `basePath` is the path mounted on that origin. For a domain root, use `basePath: ''`. For a repository Pages site, use its repository path, such as `/my-docs`. Changing a mount path requires rebuilding.

Put intended public assets in the configured assets directory and refer to them through the supported configuration. Reader appearance preferences stay local to each visitor. See [customization and SEO](customization.md), [localization](internationalization.md), [API versions](versioning.md) and [Reader settings](reader-layout.md).

Reviewed [build plugins](plugins.md) and [Reader extensions](reader-extensions.md) use `--trust-plugins`. Start with ordinary Markdown and the built-in UI; enable executable extensions after reviewing their source and declared inputs.

## Deploy a static publication

1. Set the final `siteUrl` and `basePath`.
2. Run `validate`, then `build`.
3. Upload the complete `.doctopus/site/` directory to your static host, preserving its paths and assets.
4. Configure the host to serve directory `index.html` pages under the chosen mount.
5. Test the root, a direct guide URL, a direct endpoint URL, reloads, search, settings and the playground.

Keep the generated directory intact, including its manifest. No SPA fallback is required: pages are pre-rendered. The CLI and framework adapters verify the manifest before serving. An ordinary static host must be configured to serve only intended publication files.

A static deployment needs no Studio, Worker, database or registry credentials. The live playground calls your API from visitors' browsers; the documentation host does not implement that API. For a local network preview, explicitly add `--host 0.0.0.0` to `serve`; the default binding is loopback. Use an appropriate HTTPS web server or reverse proxy for public hosting.

The repository's [Pages demo workflow](pages-demo.md#deployment-pipeline) publishes its dedicated mock demo after successful main checks. Your own publication can use the same build-and-upload model with its own hosting configuration.

## Integrate with Spring Boot

The default direct setup bundles the UI and loads your spec URL in the browser. Use [Spring Boot direct mode](direct-integrations.md#spring-boot) for the dependency, raw spec endpoint and `application.yml` title/theme settings. No documentation project or Node installation is required by a Java consumer of published artifacts.

The remainder of this section covers the optional prebuilt publication workflow for sites with authored guides. Your application continues to provide its own API and security.

### Import your generated OpenAPI document

If your application uses springdoc's standard endpoint, run the application, then import a local snapshot:

```sh
node "$DOCTOPUS_REPO/packages/cli/dist/main.js" import-spec \
  http://127.0.0.1:8080/v3/api-docs "$DOCS_PROJECT" \
  --allow-origin http://127.0.0.1:8080 \
  --allow-http --allow-private-network --output openapi.json
```

Use your actual generator URL if customized. Set `specs[0].path: openapi.json`, choose mock or live mode, and rebuild. Later imports require `--replace` to refresh an existing snapshot. Protected sources can use `--bearer-env`; multi-file specs need a bundled document or pinned references. See [remote importing](remote-import.md).

Spec changes become visible after importing or replacing the local source, building, and deploying a new publication. The Reader does not poll the generator endpoint.

### Install the Java artifacts from this checkout

Use a JDK supported by the [Java compatibility guide](java-validation.md); the current matrix covers JDK 17, 21 and 25. The included Maven wrapper downloads its pinned Maven version.

```sh
cd "$DOCTOPUS_REPO"
node scripts/prepare-java-fixture.mjs
cd integrations/java
./mvnw --batch-mode --no-transfer-progress --strict-checksums install
```

On native Windows, use `mvnw.cmd`. This installs the parent, core and Spring starter into your local Maven repository. Add the starter to your application's POM, using the version declared by your checkout's `integrations/java/pom.xml`:

```xml
<dependency>
  <groupId>dev.niessen</groupId>
  <artifactId>doctopus-spring-boot-starter</artifactId>
  <version>0.2.0-candidate.7</version>
</dependency>
```

The example version matches this checkout; use a matching version when working from a different release. Run the application build under the same user/local Maven repository used for installation. GitHub registry installation is a separate path described in [GitHub Packages](github-packages.md).

### Mount the publication

Build your documentation with `basePath: /docs`, then copy the complete `.doctopus/site/` directory to a location the application can read, such as `/srv/documentation/site`. Configure Spring:

```yaml
doctopus:
  enabled: true
  directory: /srv/documentation/site
  path: /docs
```

Start the application and open **[http://127.0.0.1:8080/docs/](http://127.0.0.1:8080/docs/)** for a default local application. Adapt the origin to your deployment. The publication is verified before resource handlers are registered. Configure Spring Security for the whole documentation tree, including scripts, page data and search files.

The compiled `basePath` must include the application context prefix plus the documentation path. For a `/gateway` context and `/docs` mount, build with `/gateway/docs`. Set `doctopus.public-base-path` when a trusted reverse proxy exposes a different prefix. Root mounts and additional integrity pinning are covered in [framework integrations](integrations.md#spring-boot).

To update, build a new publication, deploy it as an immutable replacement and restart the application using that directory. Studio, the management Server, PostgreSQL and the Worker are not required for this setup.

## Integrate with Express or Fastify

For normal API-only integration, use [Express](direct-integrations.md#express) or [Fastify](direct-integrations.md#fastify) direct mode: supply a spec URL and runtime options, with no CLI or project config file.

The adapters require Express 5 or Fastify 5. The following examples cover optional prebuilt publications, using ES modules and `basePath: /docs`.

### Install a source-built adapter

The Doctopus checkout already links its workspace packages. For a separate npm-based application, create local archives after building the checkout:

```sh
cd "$DOCTOPUS_REPO"
export DOCTOPUS_PACK_DIR="$(node scripts/pack-npm.mjs)"
printf '%s\n' "$DOCTOPUS_PACK_DIR"
```

The command prints the archive directory and writes its package inventory. In your application's directory, install the archives together so the matching internal package versions resolve locally:

```sh
npm install --ignore-scripts "$DOCTOPUS_PACK_DIR"/*.tgz
```

This source-installation path does not require unpublished GitHub packages. It installs the public Doctopus component set. Keep the resulting package manifest and lockfile in your application; use one package manager consistently within that application. For an available registry release, follow [GitHub Packages](github-packages.md) instead.

Set the publication directory before starting either example:

```sh
export DOCS_DIRECTORY="$DOCS_PROJECT/.doctopus/site"
```

### Express

Install `express@5` in the application and place this in a `.mjs` file or an ES-module project:

```js
import express from 'express';
import { createExpressDocs } from '@davidniessen/doctopus-node/express';

const app = express();
const docs = await createExpressDocs({
  directory: process.env.DOCS_DIRECTORY,
  // authenticate: yourExistingAuthenticationMiddleware,
});
app.use(docs.mountPath, docs.router);
app.listen(8080, '127.0.0.1');
```

Start it with Node and visit **[http://127.0.0.1:8080/docs/](http://127.0.0.1:8080/docs/)**. In an existing application, keep its server and routes and mount only the documentation adapter.

### Fastify

Install `fastify@5` and register the adapter:

```js
import Fastify from 'fastify';
import { doctopusPlugin } from '@davidniessen/doctopus-node/fastify';

const app = Fastify();
await app.register(doctopusPlugin, {
  directory: process.env.DOCS_DIRECTORY,
  // authenticate: yourExistingOnRequestHook,
});
await app.listen({ port: 8080, host: '127.0.0.1' });
```

The adapter checks the publication and mount path at startup. Use the application's authentication hook for private documentation. Create a new adapter instance or restart the application to serve an updated immutable publication. See [Node integration options](integrations.md#express) for quotas and proxy configuration.

Other languages can serve the static publication through their existing file-serving framework. Dedicated native adapters for other runtimes have their own implementation status in [framework integrations](integrations.md#other-languages-and-runtime-environments).

## Install Server and Studio

Use this path when you want centralized projects, private access, publication history and administration. These steps create a fresh, local Docker Compose installation. They require Docker Engine with Compose v2 and the source checkout built earlier.

### Start a local management installation

From the repository root:

```sh
cd "$DOCTOPUS_REPO"
node scripts/init-deployment.mjs
export COMPOSE_PROJECT_NAME=doctopus
export DOCS_PORT=8090
export PUBLIC_URL=http://127.0.0.1:8090
export INSECURE_DEVELOPMENT=true
docker compose -f deploy/compose.yaml build
docker compose -f deploy/compose.yaml up -d --wait
docker compose -f deploy/compose.yaml ps
curl --fail http://127.0.0.1:8090/health/ready
```

Initialization creates a private `deploy/.secrets` directory and refuses to replace existing credentials. Compose starts PostgreSQL, applies migrations and starts the Server with Studio. It does not start a Worker. Port 8090 avoids the common local application port 8080; choose another free `DOCS_PORT` and matching `PUBLIC_URL` if needed.

Open **[http://127.0.0.1:8090/admin/](http://127.0.0.1:8090/admin/)**. Sign in with the operator token generated in `deploy/.secrets/root_token`, using your secure local credential viewer. Keep the secret directory private and outside version control.

### Create and publish a project

1. In Studio Overview, create a project named **My API**, URL slug **my-api**, and your chosen public/private visibility.
2. Set your documentation project's `basePath` to `/docs/my-api` and build again. Omit `siteUrl` for this local HTTP evaluation, or use the actual HTTPS origin for a production publication:

   ```sh
   node "$DOCTOPUS_REPO/packages/cli/dist/main.js" validate "$DOCS_PROJECT"
   node "$DOCTOPUS_REPO/packages/cli/dist/main.js" build "$DOCS_PROJECT"
   ```

3. Stage that publication into the Compose artifact volume using a separate, temporary publisher container:

   ```sh
   ARTIFACT_ID="$(docker run --rm --pull=never --network none \
     --read-only --cap-drop=ALL --security-opt=no-new-privileges \
     --tmpfs /tmp:rw,noexec,nosuid,size=64m \
     --mount "type=bind,source=$DOCS_PROJECT/.doctopus/site,target=/publication,readonly" \
     --mount "type=volume,source=${COMPOSE_PROJECT_NAME}_artifacts,target=/data/artifacts" \
     --entrypoint node "${DOCS_IMAGE:-doctopus:local}" \
     packages/cli/dist/main.js stage /publication --store /data/artifacts)"
   printf '%s\n' "$ARTIFACT_ID"
   ```

   This uses the same named artifact volume as the Compose project above. The Server retains its read-only artifact mount. The printed value is the verified publication's public SHA-256 identifier. Ensure the publisher container, which runs as UID 1000, can read the input directory.

4. Select **My API → Publications**, paste that identifier into **Artifact SHA-256**, and choose **Verify and publish**.
5. Open **[http://127.0.0.1:8090/docs/my-api/](http://127.0.0.1:8090/docs/my-api/)**. Public projects can be read anonymously; private projects require an authorized session or project access credential.

For an update, build, stage and publish a new artifact. Publication history retains earlier versions. To roll back, publish an earlier retained artifact again. Do not change bytes inside an already staged artifact directory. Automated publication through environment-supplied credentials is documented in [CLI publishing](cli.md#self-hosted-publication-protocol).

### Move the management installation to production

Set `PUBLIC_URL` to the external HTTPS origin, remove the local `INSECURE_DEVELOPMENT=true` setting, configure a TLS reverse proxy, and recreate the service with the matching environment. The shipped [Caddy template](../deploy/Caddyfile) is one starting point. Preserve the `/admin/`, `/api/`, authentication and `/docs/` routes.

Back up PostgreSQL and the immutable artifact store together. Keep secret material separately protected. Follow [deployment and recovery](deployment.md) for image pinning, migrations, backup/restore, graceful shutdown and offline installation. The [Kubernetes template](../deploy/kubernetes.yaml) requires cluster-specific database, storage, secrets, ingress and recovery configuration.

To stop the local installation without deleting its data:

```sh
docker compose -f "$DOCTOPUS_REPO/deploy/compose.yaml" stop
```

## Add automated builds with a Worker

Manual builds and publication work without a Worker. Queued Studio builds need a separate supported Linux build host with matching Node.js/tooling, Docker and an approved immutable builder image.

1. Prepare reviewed documentation sources on that build host. Run `source-info <directory> --json` with the CLI to obtain their snapshot metadata.
2. In Studio Builds, approve the source metadata and exact execution policy. The Server records the approval; it does not upload source files or choose a host directory.
3. Configure the Worker's local registry with that approval, canonical source directory, matching snapshot and policy. Set its artifact root to the shared immutable store used by the Server.
4. Supply `BUILD_WORKER_CONFIG_FILE` and the protected `ROOT_TOKEN_FILE` through the host's configuration, then run `pnpm run worker` from the matching built checkout.
5. Queue a build in Studio, inspect its result, then choose **Review artifact from build** and explicitly **Verify and publish**.

The [complete Worker setup](build-worker.md) provides the registry format, immutable-image requirements, credentials, capacity, cancellation and recovery steps. [Isolated builds](isolated-builds.md) describes the container runner and source approvals. Keep the Docker-capable build host separate from the request-serving application. A completed build registers an artifact; publication remains a separate action. Source changes require a new inspection/approval and a matching Worker registry entry; restart the Worker after updating its registry.

## Validate, update and maintain the installation

For ordinary documentation changes:

```sh
node "$DOCTOPUS_REPO/packages/cli/dist/main.js" validate "$DOCS_PROJECT"
node "$DOCTOPUS_REPO/packages/cli/dist/main.js" doctor "$DOCS_PROJECT"
node "$DOCTOPUS_REPO/packages/cli/dist/main.js" build "$DOCS_PROJECT"
```

Doctor checks local links, examples, fragments and documentation coverage. Review its diagnostics; use `--strict` in CI after meeting your chosen policy. To review an API change, use `diff <before-spec> <after-spec>` and the [contract-diff exit-code reference](contract-diff.md).

For tool updates, select a reviewed release/commit in the Doctopus checkout, install its matching Node.js/pnpm versions, run the locked dependency installation and `pnpm run build`, then rebuild and test your publication. Reinstall matching Java artifacts or source archives when updating integrations. Update documentation-generation tools in CI independently from your deployed API.

Managed-platform upgrades additionally need a coordinated database/artifact backup, compatible image selection and the matching migration job. Keep existing deployment secrets; use the documented rotation process when changing credentials. See [deployment](deployment.md), [offline installation](offline-installation.md) and [release/distribution status](github-packages.md).

## Troubleshooting

| Symptom                                                | Check                                                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation reports unsupported engines               | Use the checkout's `.node-version` and `packageManager` pin. Reinstall dependencies with the correct tools.                                           |
| Renamed npm/Maven package returns 404                  | Check publication availability. Use the source-installation steps or the explicitly archived release instructions.                                    |
| Assets, search or deep links return 404                | Match `basePath` to the externally served path, upload the entire publication, and configure directory index pages. Rebuild after changing the mount. |
| Send mock never reaches the backend                    | This is mock mode's intended behavior. Set the actual OpenAPI `servers` URL and `explorer.mode: live`, then rebuild.                                  |
| A live request fails although curl works               | Check browser CORS/preflight rules, HTTPS mixed content, the published server URL and required authentication. Inspect the browser network error.     |
| The request URL cannot be edited                       | It is derived from the spec and parameter inputs. Change the published server in the specification, then rebuild.                                     |
| A required path field seems unaffected by its checkbox | The checkbox permits an empty value; a nonempty required value is still sent.                                                                         |
| The response editor cannot be edited                   | It is a response viewer. Edit the request body using Form or JSON instead.                                                                            |
| Field controls are unavailable for a schema            | Use JSON and inspect the [supported body controls](explorer-bodies.md). The API still validates the submitted body.                                   |
| A spec references an external URL                      | Import a bundled snapshot or use [pinned references](reference-snapshots.md). Ordinary builds do not fetch references from the network.               |
| MDX or a plugin is refused                             | Review the content and use its separate trust flag only when intended. Markdown needs neither flag.                                                   |
| Spring startup rejects a publication                   | Check manifest integrity, adapter compatibility, filesystem access and the compiled context/mount path. Use matching rebuilt artifacts.               |
| The Node adapter cannot find the publication           | Set an absolute `DOCS_DIRECTORY`, verify the complete built directory and match its mount path.                                                       |
| Studio queues a build that never starts                | Configure and start a Worker with the matching source approval, snapshot, image and policy.                                                           |
| Server readiness returns 503                           | Check database connectivity, matching migrations, configured deadlines and Server logs. Use the recovery guide for damaged or incomplete deployments. |
| A local port is already occupied                       | Stop only your preview process or choose another port; update the corresponding URL and any origin configuration.                                     |

For more detail, see the [CLI reference](cli.md), [Reader interface guide](design/interface.md), [server operations](server.md), [build controls](studio-builds.md), [plugins](plugins.md), and [contributor checks](../CONTRIBUTING.md).
