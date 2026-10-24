# Framework integrations

Published npm and Maven distributions use [GitHub Packages](github-packages.md). Configure its registry and GitHub authentication before installing a released package; source-checkout examples below remain usable without publishing accounts.

All integrations serve the same verified static publication. Build it once with the CLI; no Node process is required inside a Java application. Adapter code does not generate OpenAPI from arbitrary application source: consume your framework's established OpenAPI generator instead.

## Express

Build with `basePath: /docs`, then mount the adapter:

```js
import express from 'express';
import { createExpressDocs } from '@davidniessen/doctopus-node/express';

const app = express();
const docs = await createExpressDocs({
  directory: './documentation/.doctopus/site',
  // authenticate: yourExistingAuthenticationMiddleware,
});
app.use(docs.mountPath, docs.router);
app.listen(8080);
```

The optional middleware runs before every documentation request, including search and assets. Use host authentication for private docs; hiding the navigation is insufficient. The adapter verifies the artifact at startup and rejects a mount path that disagrees with the compiled configuration. Express and Fastify serve only files listed in that verified manifest; page-directory aliases require a listed `index.html`. Extra files, symlinks and the manifest itself are not automatically public. Keep the publication directory immutable while serving it, and create a new adapter instance for a replacement publication. Startup verification and the file allowlist do not lock or rehash file contents on every request.

## Fastify

```js
import Fastify from 'fastify';
import { doctopusPlugin } from '@davidniessen/doctopus-node/fastify';

const app = Fastify();
await app.register(doctopusPlugin, {
  directory: './documentation/.doctopus/site',
  // authenticate: yourExistingOnRequestHook,
});
await app.listen({ port: 8080 });
```

Authentication hooks remain within the plugin's encapsulation. Follow the documented immutable artifact policy and keep the generated `basePath` aligned with reverse-proxy routing.

## Node request quotas

Both adapters limit documentation requests before authentication. Each adapter instance allows 600 requests per client per 60-second fixed window and remembers at most 10,000 clients. Assets, failed authentication and missing documentation paths count toward the quota. Excess requests receive an uncached `429` with `Retry-After`; when the client table is full, unknown clients are refused until the window resets. Active quotas are never evicted to admit new clients.

Configure either adapter with the same optional settings:

```js
const rateLimit = {
  maxRequests: 600,
  windowMs: 60_000,
  maxClients: 10_000,
};
```

Pass `rateLimit` alongside `directory` to `createExpressDocs` or `app.register(doctopusPlugin, ...)`. Settings must be safe integers: `maxRequests` from 1 to 1,000,000, `windowMs` from 1,000 to 86,400,000 and `maxClients` from 1 to 100,000. Invalid or unknown options fail startup. Neighboring IPv6 clients share a `/56` quota; IPv4-mapped IPv6 addresses use their corresponding IPv4 identity.

Configure the host framework's trusted proxies narrowly so its client IP represents the actual caller. Untrusted forwarded headers must not select the quota identity. Without proxy trust, users behind the same proxy share a quota. This in-memory limit is per adapter instance and process; deployments with replicas need a gateway policy for aggregate quotas. It does not replace network-level traffic protection. Host-owned Express routes registered before a root-mounted router, and Fastify routes outside the documentation plugin, retain their host policy.

## Spring Boot

Use the [explicit snapshot importer](remote-import.md#spring-boot-and-other-local-generators) with an existing springdoc `/v3/doctopus` endpoint before building your static publication. Private-network and cleartext destinations require explicit options; protected sources can use a bearer environment variable.

Build and install the Java development artifacts with a JDK and Maven:

```sh
npm run build
node scripts/prepare-java-fixture.mjs
cd integrations/java
./mvnw --batch-mode --no-transfer-progress --strict-checksums install
```

Add `dev.niessen:doctopus-spring-boot-starter` to your application after installing or publishing the local artifacts. Use the version declared in `integrations/java/pom.xml`. Local snapshots and prepared prereleases do not imply registry availability; the protected release workflow verifies public distributions separately.

The local installation includes source and Javadoc archives. Spring-aware IDEs can complete the documented `doctopus` properties from the starter’s generated configuration metadata.

Configure a prebuilt publication:

```yaml
doctopus:
  enabled: true
  directory: /srv/documentation/site
  path: /docs
```

Auto-configuration supports servlet MVC and reactive WebFlux. It verifies the portable version 2 manifest identity and every file's SHA-256 digest before registering resource handlers. It serves only manifest-listed files and resolves page directories to `index.html`. Root navigation redirects to the index page without duplicating the application context prefix. The application's Spring Security configuration continues to protect documentation requests.

Optionally set `doctopus.artifact-digest` to an approved digest from your trusted build/release inventory; a mismatch fails startup. Older version 1 publications must be rebuilt before using this Java adapter. See [manifest verification and migration](artifact-manifest.md).

Use `doctopus.path: /` to host documentation at the application root. Compile with an empty `basePath` for a standalone root deployment, or with the application context prefix (for example `/gateway`) when it has one. The default `/docs` mount remains available. Both MVC and WebFlux retain host-owned controllers/functional routes, enforce the host security policy, and serve only publication-listed documentation files.

The publication's `basePath` must equal the application context path plus the normalized documentation mount (an empty suffix for `doctopus.path: /`). MVC uses `server.servlet.context-path`; WebFlux uses `spring.webflux.base-path`. Configuration for an inactive web stack does not change the documentation mount. For a proxy prefix that differs from the application context, set `doctopus.public-base-path` to the exact external path and compile the publication with that same path. Incorrect paths fail startup rather than producing broken assets.

Disable the integration with `doctopus.enabled=false`. Configure security rules for the entire `/docs/**` tree, including search JSON and scripts. The starter does not weaken the host security policy.

Spring Boot 3.5.16 and 4.1.1 pass the local and GitHub-hosted Linux matrix on JDK 17, 21 and 25, compiling Java 17 bytecode. Each combination runs manifest and servlet/reactive host tests without skips. See [runtime versions, evidence and the local runner](java-validation.md). The installed-consumer runner also checks one baseline-built JAR against both Boot lines with isolated MVC-only/WebFlux-only classpaths; a compatibility split will be introduced if their binary APIs diverge.

## Generic Java

`doctopus-core` provides a `Publication` that validates an artifact directory and exposes only verified paths, its artifact digest and configured base path. A servlet, JAX-RS service, or other framework can use it with its own authentication and static serving mechanism. The optional constructor digest pins a deployment to an approved artifact. It requires no JavaScript engine or embedded web server.

## Other languages and runtime environments

Serve the static artifact using an existing authenticated file server, reverse proxy, or framework resource handler. The manifest and site configuration are portable JSON. Framework-specific source generation and native adapters for Python, Go, .NET, and other runtimes remain roadmap work; static hosting works independently of those adapters.
