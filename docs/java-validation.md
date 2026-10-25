# Java runtime validation

The Spring integration supports direct OpenAPI URLs with bundled classpath assets as well as optional verified filesystem publications. The workspace build prepares the browser bundle and Java resource inventory before Maven runs. Consuming JARs need no Node runtime or documentation config file. See the [application quickstart](direct-integrations.md).

The declared support matrix is in the Java job of `.github/workflows/quality.yml`: JDK 17, 21 and 25 with Spring Boot 3.5.16 and 4.1.1. The local runner reads that matrix rather than maintaining a separate list.

After installing dependencies and running `npm run build`, set `JAVA17_HOME`, `JAVA21_HOME` and `JAVA25_HOME` to the corresponding JDK directories, then run:

```sh
npm run test:java-matrix
```

The runner prepares a fresh real publication, checks each runtime's version and runs the Maven wrapper sequentially for every combination. It removes only generated JUnit reports before each run and requires nonzero, successful manifest, bundled-UI and servlet/reactive host suites without skipped tests. The source CI job uses the same result checks after its Maven invocation. A successful Maven exit with skipped tests cannot satisfy this gate.

Reports live in `.doctopus/java-matrix/<commit>-<run>/report.json`, with per-combination local Maven logs. Reports record source commit/dirty state, runtime versions, platform, publication identity and suite counts. A root `passed` flag is set only after every expected combination completes. Raw JUnit property blocks are not copied into the report. Java option banners and credential-valued environment variables are omitted from retained logs; use only fixture data in tests and review logs before sharing.

The local runner supports Linux, macOS and WSL. `JAVA_MATRIX_MAVEN` can select an installed Maven executable; otherwise it uses the repository wrapper. `JAVA_MATRIX_MAVEN_ARGS` accepts a JSON array of extra Maven arguments, for example a settings-file path or local repository override. Keep credentials in the normal Maven credential/settings mechanism rather than command arguments. The script never evaluates those arguments through a shell.

## Installed JAR consumers

Run `npm run test:java-consumers -- --matrix` with the same JDK home variables to verify the distributed binary independently of reactor classes. For one runtime, set `JAVA_HOME` and run `npm run test:java-consumers -- --boot 4.1.1` (or another Boot version from the quality matrix).

The runner clean-builds and installs one baseline candidate using the first declared Boot line and Java 17 bytecode. It inspects both runtime JARs without extracting archive paths, checking public entrypoints, embedded Maven coordinates/POMs, automatic Boot discovery metadata, bytecode version and the exact root license/notice files. The core archive must also contain the direct-mode shell, public API documentation, fonts, browser notices and component inventory; every bundled browser asset is rehashed against its inventory. Candidate archives and the parent/module POMs remain under `.doctopus/java-candidates/<commit>-<run>/` with their SHA-256 inventory. Installing writes the project's development coordinates into the configured local Maven repository; it does not publish them to a registry.

Each selected JDK/Boot combination consumes those exact installed bytes from separate temporary Maven projects outside the checkout. MVC-only and WebFlux-only classpaths must exclude the opposite stack. Public classes must originate in JARs outside the source checkout and match the candidate hashes. Tests serve real publications at `/gateway/docs`, at the context root `/gateway`, and at a standalone root behind host Spring Security. They pin each manifest digest, verify redirects with and without trailing slashes, preserve host-owned routes, and reject both missing and physically present unlisted files. Each isolated stack also starts without a publication directory and serves the bundled direct-mode shell, CSS, JavaScript and component inventory under normal and context-prefixed paths. These checks retain host authentication/routes, verify the default context-prefixed specification URL and reject private manifests, source maps and missing files. Each consumer then removes generated test classes and recompiles offline from the resolved cache. Temporary projects are removed; sanitized Maven logs, current suite counts and candidate inventories are retained. Fresh nonzero suites without failures or skips are required. The result reader also requires every named package, subpath and root-hosting scenario; partial test selection cannot satisfy the gate.

`JAVA_CONSUMER_MAVEN` and `JAVA_CONSUMER_MAVEN_ARGS` select an installed Maven executable and a JSON array of extra arguments; their `JAVA_MATRIX_*` equivalents are accepted as fallbacks. Keep credentials in Maven settings. The configured local Maven repository must be outside the source checkout so origin assertions can reject reactor/build classes. The runner uses normal checksum/TLS verification and never interprets argument strings through a shell.

Feature/PR/default-branch checks and the manual prepared-version rehearsal include installed consumers in every Java job before the source matrix check. Local validation does not establish that GitHub Actions ran, that the Maven namespace is owned, or that packages are signed or published. Registry installation and signature/provenance verification remain release work.

## Candidate distributions and IDE configuration

Each module now attaches a source archive and a Javadoc archive during the Maven package phase. The candidate runner verifies the public source/API entries and checks the exact root license/notice contents in all six JARs: runtime/source archives use `META-INF`, while Javadoc archives use `resources/legal` and retain the doclet’s own notices. Public API documentation is generated with doclint enabled and without fetching external API links.

The Spring starter includes generated `META-INF/spring-configuration-metadata.json` for IDE completion and property descriptions. The gate verifies all five properties, their source types, descriptions and the real defaults for `enabled` and `path`. The configuration processor is a build dependency and is not added to consuming applications’ runtime classpaths.

A pinned CycloneDX Maven plugin generates a 1.6 JSON inventory of the baseline reactor’s compile, provided and runtime dependencies, including the optional web-stack dependencies and excluding test libraries. The runner checks component coordinates, graph completeness, licenses for project components and package URL consistency, then binds the parent POM and both runtime JARs to their inspected SHA-256 hashes. Third-party component records remain unchanged. `java-bom.cdx.json` and its checksum are retained with source/Javadoc inventories in the candidate report and CI artifacts. Applications should generate their own resolved runtime SBOM after choosing their framework BOM and deployment dependencies.

The 2026-10-22 development run passed all six archive inspections, the five-property metadata check, a 20-component/21-node dependency inventory, all twelve installed consumers (24 tests without skips and twelve offline compilations), and all six source combinations (60 tests without skips). The Node tooling gate has 73 passing tests and the compiler/component suite has 380. Candidates remain unsigned and unpublished; namespace ownership and the release-wide distribution/license review are separate gates.

## Selected publishing namespace

The selected Maven group is `dev.niessen`. Parent/module dependencies, consumer fixtures and embedded-coordinate/SBOM checks use that group. The `doctopus` artifact names remain placeholders pending the product rename; Java source packages retain their existing API identities. The configured target is [GitHub Packages](github-packages.md), which needs GitHub authentication rather than a Maven Central account or production GPG key. Actual signed-producer/registry acceptance remains separate from local candidate tests.

A local follow-up from source `568f2ad` with the namespace changes in its working tree passes all six JDK 17/21/25 × Boot 3.5.16/4.1.1 combinations (60 tests, no skips) and all 12 physically installed MVC/WebFlux consumers (48 tests, no skips, with offline compilation). Candidate reports record the dirty source and unverified publication/signature state. Older evidence below uses the previous development coordinates.

## Recorded Linux validation

The 2026-10-22 local matrix used Temurin 17.0.21+9, 21.0.13+9 and 25.0.5+8 on Linux x64. Each runtime passed both Boot lines with 8 manifest tests and 2 servlet/reactive host tests: 60 test executions across six combinations, no skips. The host tests serve real generated pages, search, scripts and OAuth callback assets behind Spring Security and an approved-digest pin.

The installed-JAR run on the same date built one baseline candidate against Boot 3.5.16 and consumed the same core/starter hashes across all six runtime/Boot combinations. Twelve isolated MVC-only/WebFlux-only consumers passed 24 current tests without skips and twelve fresh offline compilations. The new context-prefix journey found and fixed MVC's duplicated-context redirect. Runtime archives include the exact Apache license/notice, Java 17 bytecode, matching Maven metadata and automatic Boot discovery resources. The retained local candidate is an unpublished development snapshot with dirty-source state recorded; this is not registry installation or signed provenance.

A separate prepared-version rehearsal from source `1db4ed0` installed npm tooling offline in a temporary clone, executed the exact release-preparation composite action to apply canonical `0.2.0` metadata, built the product and passed both installed consumers on Java 21 / Boot 4.1.1. Four current tests and both offline compilations passed using inspected `0.2.0` JAR/POM coordinates. Evidence is retained locally under `.doctopus/release-rehearsals/1db4ed0c1aa4-installed-java-0.2.0-1792706749010/`; the temporary clone was removed. This targeted canonical-version check is separate from the development-version full matrix and the earlier full release rehearsal. Nothing was tagged or published.

The complete distribution follow-up at source `f75e9ef` repeated the exact composite preparation action and production build with canonical `0.2.0` metadata in a fresh temporary clone. Both runtime JARs, four source/Javadoc archives, five IDE properties and the bound Java SBOM passed the gate. Both Java 21 / Boot 4.1.1 consumers passed four current tests without skips and two offline compilations. Evidence is retained under `.doctopus/release-rehearsals/f75e9ef8af38-installed-java-0.2.0-1792708722136/`; the clone was removed. No release was tagged or published.

The root-hosting follow-up passed 48 current installed-consumer tests across the twelve isolated applications (four per consumer), including both root variants and preserved host-owned routes, with twelve offline compilations and no skips. The source matrix also passed all 60 tests. Fixture-only system properties use the `consumer` namespace to keep Spring relaxed binding from overriding SDK configuration between variants; each publication retains its own digest pin. A follow-up regression supplies deliberately conflicting settings for the inactive web stack. The active-stack context provider keeps MVC and WebFlux on their actual prefixes; the same twelve consumers pass all 48 cases, and all six source combinations pass 60 tests. The engineering estimate remains unchanged for this focused hosting increment.

A clean prepared-version rehearsal from `e6fb837` applied canonical `0.2.0` metadata through the exact composite action, rebuilt the product and passed the complete distribution gate. Both Java 21 / Boot 4.1.1 installed consumers passed all eight current tests, including context-prefixed and standalone root hosting with conflicting inactive-stack settings, plus two offline compilations. All six archives, five IDE properties, baseline SBOM and three publication digest pins passed verification. Evidence is retained under `.doctopus/release-rehearsals/e6fb837c6da2-installed-java-0.2.0-1792711380878/`; the temporary clone was removed. Nothing was tagged or published.

The JDK downloads matched both the Adoptium API metadata and release checksum files, and their detached signatures verified against the pinned Adoptium key `3B04D753C9050D9A5D343F39843C48A565F8F04B`. Recorded archive SHA-256 digests:

| Runtime           | Archive SHA-256                                                    |
| ----------------- | ------------------------------------------------------------------ |
| Temurin 17.0.21+9 | `8b9b611d917e3dfd8419d3566b5949226f69b052fed7e109c1368add1dfe8711` |
| Temurin 21.0.13+9 | `d7f5d5cf865a2902b70ff549b97586a7d3f234e016f041ab447ea740c7d66d1c` |
| Temurin 25.0.5+8  | `68982529869257d0ee6b824ec5aa270ff8b118bb438670da0b97ebdab178d7fb` |

This evidence covers the tested Linux checkout and fixtures. GitHub-hosted execution remains unverified while account billing prevents Actions from starting; other operating systems, architectures, external applications and registry installation remain separate release evidence.
