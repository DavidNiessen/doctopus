# Migrating to Doctopus

The project is now **Doctopus**. The rename applies to the reader, Studio, CLI, Java/Spring Boot integration, package names, generated working directories, configuration properties and deployment examples.

The renamed source is available before the next package release. **Doctopus package coordinates are not yet published.** Build from source using the [README](../README.md). The previously accepted `0.2.0-candidate.7` release is immutable and remains available under its [archived installation instructions](archive/0.2.0-candidate.7-installation.md). Its original artifact names and hashes are retained in the [release acceptance record](release-acceptance.md).

## Source and package names

| Component                | Doctopus name                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository               | `DavidNiessen/doctopus`                                                                                                                        |
| CLI executable           | `doctopus`                                                                                                                                     |
| npm packages             | `@davidniessen/doctopus-cli`, `@davidniessen/doctopus-node`, `@davidniessen/doctopus-reader`, and the same prefix for other workspace packages |
| Maven group              | `dev.niessen` (unchanged)                                                                                                                      |
| Maven artifacts          | `doctopus-parent`, `doctopus-core`, `doctopus-spring-boot-starter`                                                                             |
| Java packages            | `dev.niessen.doctopus.core`, `dev.niessen.doctopus.spring`                                                                                     |
| Spring configuration     | `doctopus.*`                                                                                                                                   |
| Generated project folder | `.doctopus/`                                                                                                                                   |
| Container namespace      | `ghcr.io/davidniessen/doctopus`                                                                                                                |

Update package dependencies, Java imports and Spring configuration together when adopting a released Doctopus distribution. Do not combine renamed packages with legacy integration classes. Consult [framework integrations](integrations.md) for complete examples.

## Rebuild generated documentation

For compiled sites, the authored `docs.config.yaml`, guides and OpenAPI source files remain your source of truth. Rebuild them with Doctopus instead of copying a legacy output directory to the new path. The CLI now writes `.doctopus/site`; update static-host build commands, CI caches, volume mounts and deployment paths accordingly. Existing static documentation continues to work until you replace it.

Doctopus-specific OpenAPI extensions use the `x-doctopus-` prefix. Rename the product-specific extension keys in your own specs; standard OpenAPI fields are unchanged. Update any custom plugin hooks, client-event names, browser-storage integrations or automation that used product-specific identifiers. Browser preferences stored by the legacy UI are separate from the new Doctopus preferences; select your preferred appearance and layout again after upgrading.

## Optional server and Studio

The rename does not migrate PostgreSQL data or rename existing databases, roles, Docker volumes or running services. Keep your existing `DATABASE_URL` and persistent-volume configuration when upgrading an installation. The renamed Compose defaults are intended for fresh installations. Back up your database and publications, preserve the existing volume explicitly, then follow the [deployment and recovery guide](deployment.md) before replacing a running installation.

The ordinary Java/Spring Boot integration still serves a built documentation publication without requiring Studio, PostgreSQL or a Node runtime in the deployed Java application.

## Release evidence and branding

Historical package receipts, release tags, hashes and archived installation commands retain their original identifiers so they remain verifiable. New Doctopus releases require fresh signed candidate, package-consumer and container acceptance; a branding update does not reissue the previous release.

Use the [brand guide](branding.md) and [asset kit](../assets/brand/) for the Doctopus identity. Configured project logos and prepared reader themes remain supported.

## Direct framework setup

The current Spring and Node adapters can also load a spec URL directly. Set `doctopus.url` and branding in Spring properties, or `url` and branding in Node options. Omit `directory`; this setup needs no documentation project configuration or CLI build. Existing directory-based integrations retain their verified publication workflow. Do not combine direct options with a prebuilt directory. See the [direct integration guide](direct-integrations.md).
