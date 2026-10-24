# ADR 0001: GitHub Packages distributions

Status: accepted distribution decision; production acceptance remains pending.

Date: 2026-10-24.

## Context

The repository owner selected GitHub Packages for JavaScript and Java distributions and does not want separate npm or Maven Central accounts. The project needs dependency-manager installation, exact accepted artifacts, source-bound provenance, protected publishing and independent installed-consumer verification. The project was subsequently named Doctopus; accepted prerelease artifacts retain their original coordinates.

## Decision

Use npm scope `@davidniessen` at `https://npm.pkg.github.com`, Maven group `dev.niessen` at `https://maven.pkg.github.com/davidniessen/doctopus`, and `ghcr.io/davidniessen/doctopus` for containers. Source policy binds destinations to the source repository owner/name. Renaming or transferring the project requires matching reviewed coordinates and a new candidate.

Publish from the protected `release` environment with short-lived repository Actions tokens. npm and Maven publishers receive package-write permission; their separate consumers receive read permission. Only the OCI publisher and fresh security-report producer need OIDC in the publishing workflow. A production OpenPGP key and external registry credentials are unnecessary.

Retain original producer attestations for all accepted subjects. Fresh npm/Maven consumers download registry bytes, check their accepted hashes and verify those producer attestations against the exact source tag/commit and hosted workflow. Maven uses its standard deployment protocol without rebuilding accepted POM/JAR files. npmjs native provenance and Central/OpenPGP signatures are not requirements of the selected GitHub transport.

[ADR 0004](0004-github-artifact-downloads.md) records GitHub's signed artifact CDN redirects and the credential-free, exact-origin download path. Metadata and writes retain redirect refusal.

Public npm acceptance additionally requires the package to be public and connected to its source repository. Maven inherits the source repository's access model. Anonymous GHCR acceptance remains required for the public container. Private package access by a workflow token cannot establish a successful public release.

## Consequences

- Local npm/Maven installation requires GitHub authentication, including for public packages. CI uses a repository token with package-read access; external consumers follow GitHub's supported personal-token authentication. The [installation guide](../github-packages.md) records both flows.
- GitHub can create new npm/GHCR packages as private. Owners must set public visibility after first publication and rerun all publication jobs; exact matching versions are reused.
- Third-party dependencies still come from npmjs/Maven Central. Building from source and serving generated documentation do not require publishing accounts. Deployed Java applications need neither a Node runtime nor GitHub package credentials.
- npmjs/Central transport helpers retain their standalone tests, but the configured workflow targets GitHub. A future provider change needs a reviewed policy/transport update and fresh registry acceptance.
- Registry writes and public installation remain required acceptance evidence. [ADR 0002](0002-deferred-prerelease-reviews.md) records the later owner decision to defer independent launch reviews for prereleases; this ADR does not approve production publication.
