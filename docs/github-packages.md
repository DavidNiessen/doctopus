# Install from GitHub Packages

Current source integrations offer direct OpenAPI mode: bundled assets, a spec URL and application settings. Once matching renamed artifacts are published, consumers need no documentation CLI build or config file. Until then, use the [source installation instructions](direct-integrations.md#source-installation). Archived releases below describe their historical capabilities.

Doctopus packages use the coordinates below for future releases. **The renamed packages are not yet published.** Build the current source using the [README](../README.md), or follow the [archived 0.2.0-candidate.7 instructions](archive/0.2.0-candidate.7-installation.md) for the previously accepted release under its legacy names. Those immutable artifacts remain unchanged. Independent reviews and stable release approval remain open.

GitHub requires authentication to download npm and Maven packages, including public packages. No npm or Maven Central account is needed. For local installation, use your GitHub username and a personal access token **classic** with `read:packages`, following [GitHub's npm registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry) and [Maven registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-apache-maven-registry). Keep token values out of source control, command arguments and chat.

## JavaScript and TypeScript

Set the project registry for this scope and authenticate interactively:

```sh
npm config set @davidniessen:registry https://npm.pkg.github.com --location=project
npm login --scope=@davidniessen --auth-type=legacy --registry=https://npm.pkg.github.com
```

Use your GitHub username and the token when prompted, then replace `DOCTOPUS_VERSION` with an actually published Doctopus version before installing:

```sh
npm install @davidniessen/doctopus-node@DOCTOPUS_VERSION
```

The Express/Fastify entry points are `@davidniessen/doctopus-node/express` and `@davidniessen/doctopus-node/fastify`. The CLI package is `@davidniessen/doctopus-cli`; its executable remains `doctopus`. See [framework integrations](integrations.md) and the [CLI reference](cli.md). Stable releases use npm's `latest` channel.

For CI, use a repository token with `packages: read`, configure the same scope and set this npm configuration with a literal environment reference:

```ini
@davidniessen:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Supply `GITHUB_PACKAGES_TOKEN` only to the installation step. Grant the consuming repository access in the package's Actions access settings when required. Ordinary third-party dependencies continue to come from npmjs.

## Maven and Spring Boot

Add the repository and the required version to your project POM:

```xml
<repositories>
  <repository>
    <id>github</id>
    <url>https://maven.pkg.github.com/davidniessen/doctopus</url>
  </repository>
</repositories>
```

```xml
<dependency>
  <groupId>dev.niessen</groupId>
  <artifactId>doctopus-spring-boot-starter</artifactId>
  <version>DOCTOPUS_VERSION</version>
</dependency>
```

Generic Java applications can use `dev.niessen:doctopus-core` at the same version. The Java/Spring integration serves an already built documentation publication and does not require Studio, PostgreSQL or a Node runtime in the deployed Java application. See the [integration guide](integrations.md).

Merge this server entry into your private Maven settings, using your GitHub username:

```xml
<settings>
  <servers>
    <server>
      <id>github</id>
      <username>YOUR_GITHUB_USERNAME</username>
      <password>${env.GITHUB_PACKAGES_TOKEN}</password>
    </server>
  </servers>
</settings>
```

Supply the token through your shell/CI secret store. The repository and server IDs must match. The publishing workflow uses the same pattern with its short-lived repository token; it does not require a Central account, a domain claim or an OpenPGP key. Third-party Spring dependencies still resolve from Maven Central.

## Containers and static hosting

The archived prerelease's Linux amd64 image passed anonymous pull/runtime checks under its legacy coordinates. Renamed Doctopus images are not yet published. Once a renamed release is available, select its documented version and pin the accepted manifest digest; the future image reference has this form:

```sh
docker pull ghcr.io/davidniessen/doctopus:DOCTOPUS_VERSION
```

The release version tag will be `ghcr.io/davidniessen/doctopus:DOCTOPUS_VERSION`. See [deployment](deployment.md) for configuration and PostgreSQL requirements of the optional server.

Generated documentation is an ordinary static directory. Serving that output needs no package-registry credentials and no account with the project maintainers. The public [mock demo](pages-demo.md) also needs no credentials.

## First publication and visibility

The protected workflow publishes only approved candidate bytes and requires the repository's `release` reviewer. npm and GHCR packages can initially be private. In your GitHub profile's **Packages**, open each new package, select **Package settings**, and change visibility to **Public**. Keep its source repository connected and its Actions access configured. Maven packages inherit their repository's access model.

Rerun all publication jobs after changing visibility; matching immutable versions are reused and fresh consumer checks must pass. A private package reachable by the workflow token is insufficient for the public npm acceptance gate. See [publication policy](publication-plans.md) for exact verification, security freshness and failure recovery.
