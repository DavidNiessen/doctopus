# Published prerelease acceptance

[0.2.0-candidate.7](https://github.com/DavidNiessen/doctopus/releases/tag/v0.2.0-candidate.7) is published from immutable tag `v0.2.0-candidate.7`, source `99fec8df8474758e5c6377945fc83335530090c7`. This record describes that release, not later changes to `master`.

The owner explicitly deferred independent security, isolation, accessibility, license reviews and external pilots for prereleases. These remain unfinished; automated acceptance and environment approval do not replace them. No stable production approval is claimed. This release predates the Doctopus rename; its legacy package names, coordinates and signed receipts remain immutable. See the [migration guide](migration-doctopus.md).

## Verified workflows

| Gate                          | Accepted run                                                                                | Result                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Main Quality                  | [40113307008](https://github.com/DavidNiessen/doctopus/actions/runs/40113307008)            | All 15 jobs passed                                                    |
| Live protection drift         | [40113306951](https://github.com/DavidNiessen/doctopus/actions/runs/40113306951)            | Passed with ordinary workflow permissions                             |
| Signed candidate              | [40113329167](https://github.com/DavidNiessen/doctopus/actions/runs/40113329167), attempt 1 | All 22 jobs and all 39 producer subjects passed                       |
| Hosted mock demo              | [40113884597](https://github.com/DavidNiessen/doctopus/actions/runs/40113884597), attempt 2 | All three jobs passed                                                 |
| Read-only publication preview | [40114670009](https://github.com/DavidNiessen/doctopus/actions/runs/40114670009), attempt 1 | 39 subjects verified, zero prerelease blockers, five reviews deferred |
| Protected publication         | [40115526978](https://github.com/DavidNiessen/doctopus/actions/runs/40115526978), attempt 1 | All nine jobs passed after owner environment approval                 |

The publication run reverified original producer attestations, live repository/environment protections and fresh signed security reports before promoting the accepted files. It did not rebuild packages or the image. The signed scan found zero Critical/High/Unknown and three Medium findings under the documented policy; dependency audit passed. This is a dated scan result, not an assurance against future advisories. See [security policy and freshness](publication-plans.md#fresh-security-for-the-accepted-image).

The original Pages attempt passed all five browser tests, but GitHub failed to finalize its verification job and eventually cancelled it at the job timeout. A full second attempt on unchanged source passed all three jobs. This retry did not waive a failed product assertion. The public demo's index and selected CSS/JavaScript/deep-page files also matched the tested artifact bytes.

After the acceptance documentation merged, [main 40118398261](https://github.com/DavidNiessen/doctopus/actions/runs/40118398261) passed all 15 jobs and [Pages 40118976356](https://github.com/DavidNiessen/doctopus/actions/runs/40118976356) passed all three jobs at documentation-only source `b44e3e5`. An additional comparison downloaded all 28 deployed reader assets and verified exact equality with the original tested demo artifact and the published reader package. This covers CSS, JavaScript, workers, source maps, the icon font and browser notices; it does not claim the demo itself was built by installing from the registry.

## Fresh registry consumers

- **npm:** all 12 packages are public and connected to the source repository. A separate read-only runner verified original archive sizes, SHA-256/SHA-512 integrity and producer attestations, installed from GitHub with an empty cache, audited dependencies, reinstalled offline and passed public CLI/types/MDX/plugin/Express/Fastify journeys. Its lockfile and SBOM were retained.
- **Maven:** all nine original POM/JAR/source/Javadoc files and producer attestations matched. A fresh empty Maven repository installed the project POMs/JARs from GitHub, verified their hashes and repository-origin markers, passed eight MVC/WebFlux tests with no skips, and compiled both consumers offline. This registry consumer used Java 21/Spring Boot 3.5.16; the signed candidate separately passed the full advertised Java/Spring matrix.
- **Container:** an anonymous consumer pulled by immutable digest, verified the promotion attestation and original image configuration ID, then passed an offline, read-only runtime probe at UID 1000 with Node 24.22.1 and the matching tool version. The image supports Linux amd64.

The accepted container reference is:

```text
ghcr.io/davidniessen/api-docs@sha256:46ebb30ad41974cfbcb9014de2982623a175358061010a48198090c95129f8ce
```

Its image configuration ID is `sha256:38acecbab164d4b7a259f847cdb5dda20a56c6d8334bb1e2b31f9296391e2e03`; its original Docker archive SHA-256 is `ab07d4b6430cfa310ed4de7f8dbdf54d0e61f29939584550c5bb47da40a9bb34`. Configuration IDs, archive hashes and registry manifest digests identify different objects.

The [machine-readable acceptance index](release-evidence/0.2.0-candidate.7.json) records original package hashes, coordinates and checks. It is a public summary of the retained workflow receipts, not a substitute for cryptographic attestation verification. See [producer verification](release-provenance.md) and [publication verification](publication-plans.md). Workflow artifacts have bounded retention; preserve evidence needed for your deployment.

## Performance and installation limits

The candidate's unchanged 10,000-operation/50,000-schema-node compiler gate measured 56.56 seconds and 928.7 MiB peak RSS, with warm search p95 8.02 ms and incremental-guide p95 350.53 ms. All compiler and cold mobile reader budgets passed. These are shared-runner observations, not a controlled speedup or production-capacity claim.

Follow the [versioned installation instructions](archive/0.2.0-candidate.7-installation.md). GitHub requires authentication for public npm/Maven downloads. Static output and the mock demo need no registry account. Java/Spring serves built documentation without Studio, PostgreSQL or a Node runtime in the deployed application; the optional publication server uses PostgreSQL.

Earlier partially published `.6` artifacts remain immutable and are superseded by this release. Install .7 explicitly. Independent reviews, stable-version acceptance and the remaining [launch checklist](planning/03-delivery-and-launch.md#6-open-source-launch-checklist) still apply.
