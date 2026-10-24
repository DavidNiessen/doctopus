# Publication policy and review plans

Distributions use GitHub Packages for npm and Maven, and GHCR for containers. Publishing uses the workflow repository's short-lived `GITHUB_TOKEN`; maintainers do not need npm or Maven Central accounts, Central tokens or a production OpenPGP key. See [package installation and authentication](github-packages.md). Third-party build dependencies still resolve from their ordinary public registries.

The [distribution decision](adr/0001-github-packages-distributions.md) records the selected identity, authentication trade-offs and remaining acceptance requirements.

[Prerelease 0.2.0-candidate.7](release-acceptance.md) passed all nine protected publication and fresh-consumer jobs after owner environment approval. Its exact files are published to all three selected registries. Independent reviews remain deferred; future versions must repeat these gates.

The manual **Review or publish verified distributions** workflow defaults to `confirm-publication: false`. That path has read-only permissions, verifies an existing signed candidate and retains a reviewable plan. Confirmed publication additionally requires approved source policy, current repository protections, a fresh scan of the accepted image and approval of the protected `release` environment.

## Source policy and destinations

`release-policy.json` schema 3 contains public coordinates and explicit decisions, never credentials. Destinations bind to the exact source repository. Unknown fields, URL credentials, foreign repositories, mismatched coordinates and malformed decisions fail validation.

| Setting               | Selected value                                       |
| --------------------- | ---------------------------------------------------- |
| npm scope             | `@davidniessen`                                      |
| npm registry          | `https://npm.pkg.github.com`                         |
| Maven group           | `dev.niessen`                                        |
| Maven registry        | `https://maven.pkg.github.com/davidniessen/doctopus` |
| Container repository  | `ghcr.io/davidniessen/doctopus`                      |
| Protected environment | `release`                                            |

Namespace decisions refer to the selected GitHub repository owner and do not require an npm organization or a Maven Central domain claim. The owner has explicitly deferred the five independent security, isolation, accessibility, license and pilot reviews for prereleases. Publication is enabled under that decision; the reviews are recorded as `deferred`, not `approved`. See [ADR 0002](adr/0002-deferred-prerelease-reviews.md).

Review statuses are `pending`, `approved` or `deferred`. Pending reviews always block publication. A deferral requires an exact source-owner identity, a bounded public reason and `prerelease` scope; stable versions still require approval. Stale deferral metadata without deferred reviews is rejected. Generated plans and workflow summaries retain the review statuses and deferral. The generated `publicationApproved` value always remains false; a plan is not environment approval or proof of registry publication.

Public npm package manifests also select GitHub in `publishConfig`; the Java parent POM selects the same repository in `distributionManagement`. Prereleases use npm's `next` channel, stable versions use `latest`. Product/package renaming requires reviewed source changes and a new matching candidate.

## Exact candidate verification

Dispatch `.github/workflows/release-publish.yml` from the candidate's canonical version tag with its exact successful candidate run ID and attempt. The clean-source guard requires aligned release versions and an upstream commit on `master`. The planner verifies the actual candidate workflow identity, event, completion, source repository/commit, latest attempt and current remote tag, including annotated tags.

Only the candidate's named npm/Java/container bundles are downloaded. Verification checks complete file sets, sizes, SHA-256 hashes and source/run bindings, then checks GitHub attestations for every subject against the exact producer workflow, source tag/commit and GitHub-hosted runner identity. A signature on an unrelated workflow or artifact cannot substitute.

The earlier [candidate 40043580095](https://github.com/DavidNiessen/doctopus/actions/runs/40043580095) and read-only [plan 40045907895](https://github.com/DavidNiessen/doctopus/actions/runs/40045907895) passed for `v0.2.0-candidate.1` / `c380ae159983025a519bbe706ecec049b755e8d8`. The GitHub Packages [candidate 40093764410](https://github.com/DavidNiessen/doctopus/actions/runs/40093764410) then passed all 22 jobs for `v0.2.0-candidate.2` / `700f6e47dd5c0299df12ef6edad383aa7fa508da`. Its [read-only plan 40095165927](https://github.com/DavidNiessen/doctopus/actions/runs/40095165927) independently reverified all 39 subjects with six source-policy blockers and every publisher skipped. Both tags remain immutable. Later .7 acceptance above includes its own matching candidate, explicit review deferral and actual registry consumption.

## Repository and environment protection

Approval-check mode inspects GitHub's actual metadata: active `Protect master` and `Protect release tags` rulesets, at least one approving PR review, stale approval dismissal, resolved conversations, up-to-date `Quality` checks from the GitHub Actions app, and restrictions on force pushes, branch deletion and version-tag updates/deletion. Only administrator-role bypasses are permitted and recorded explicitly. The `release` environment must have a required reviewer and exactly the `v*` tag deployment policy.

Verified on 2026-10-24: those ruleset/environment requirements and private vulnerability reporting are enabled. The repository owner completed the settings because the integration returns `403` for administrative writes. Source booleans cannot substitute for these checks or a protected-job approval.

GitHub redacts bypass actors from ordinary workflow tokens. `publication-protections.json` therefore captures an administrator-read source snapshot and binds it to the exact live ruleset IDs, update revisions, conditions and rules. Configuration drift fails closed; visible bypass lists are also compared directly. Receipts identify whether the actors were visible or verified through the source snapshot. This is source-reviewed policy evidence, not a claim that a read-only token enumerated hidden settings. See [ADR 0003](adr/0003-source-bound-protection-snapshots.md).

After an intentional ruleset change, use an administrator-readable GitHub CLI connection:

```sh
node scripts/snapshot-publication-protections.mjs
node scripts/check-publication-protections.mjs
```

Review and commit the public snapshot, then test a new matching candidate. The manual/daily **Publication protection drift** workflow checks the same live settings with the normal read-only token. No administration-write token or extra publishing credential is needed. Required environment reviewers and version-tag policies are always read live.

Relevant source pushes also run the drift check. Ordinary forks skip a snapshot belonging to the original repository; generate a matching snapshot when configuring fork releases. Actual publication never skips repository identity validation.

## Fresh security for the accepted image

A confirmed run audits locked dependencies and rescans the original accepted Docker archive with pinned inventory/scanner tools and current official vulnerability data. It never rebuilds the image to refresh its security evidence. The preflight job signs only the three scan reports it generated.

Each publisher and fresh consumer rehashes and reassesses those raw reports, verifies their signatures against the exact publishing workflow/tag/commit and checks the original archive/config ID, candidate run/attempt, current publication run/attempt and lockfile hash. Audits/scans must be at most 24 hours old; the official database must be at most 48 hours old. High, Critical, Unknown, suppressed or malformed findings block promotion.

If approval exceeds those freshness limits, rerun **all publication jobs** with the same candidate inputs. This creates a fresh scan for the new attempt while preserving accepted package/image bytes. Partial reruns cannot mix attempts. Candidate and verification artifacts have 14-day retention.

The nonpublishing candidate workflow exercises the same loader/audit/scanner path with `--candidate`; its distinct `candidate-rehearsal` receipt cannot authorize publication.

## npm publication and independent consumption

The protected npm job receives only package-write capability and a step-scoped repository token. It preflights every immutable version, then publishes the original tested archives in dependency order with lifecycle scripts disabled. Matching existing archives may be reused; conflicts fail before the first write. Tokens stay in the environment, and private temporary npm configuration contains only a literal environment reference. Cleanup runs on success and failure.

GitHub artifact downloads may use one signed redirect to an exact approved CDN: npm to `https://pkg-npm.githubusercontent.com`, Maven to `https://github-registry-files.githubusercontent.com`. Explicit artifact GETs alone enable this path. The second request drops all original headers, credentials and referrers; another redirect fails. Metadata and writes still refuse redirects. Size/hash/integrity and producer checks remain unchanged. See [ADR 0004](adr/0004-github-artifact-downloads.md) for native observations and the credential boundary.

GitHub Packages does not supply npmjs native provenance. The fresh consumer instead downloads each archive, checks its exact size, SHA-256 and SHA-512 integrity, then verifies its original GitHub producer attestation. It starts with an empty npm cache, installs exact versions from GitHub, rejects workspace links/foreign tarball origins, audits third-party dependencies through npmjs, reinstalls offline, runs the external CLI/types/MDX/plugin/authenticated Express/Fastify journeys and retains a lockfile and SBOM.

The consumer has only read permissions and a step-scoped repository token. It verifies each npm package is public and linked to this repository. GitHub creates new npm packages as private: change their visibility to **Public** in package settings after the first publication, then rerun all publication jobs to verify and reuse the same bytes. Authenticated access is still required to install public GitHub npm/Maven packages.

## Maven publication and independent consumption

The protected Maven job uses the pinned Maven wrapper/deploy plugin to upload the nine accepted POM/binary/source/Javadoc files without rebuilding them. Authentication uses the repository token. Owner-only temporary settings contain environment references, and no production GPG key is required. All existing bytes are checked before any deployment; entirely present matching artifact groups are reused, entirely absent groups may be deployed, and partially visible groups fail pending inspection/propagation. Receipts identify attempted/completed artifacts.

The fresh read-only consumer downloads and verifies all nine files and their original producer attestations. It uses a new empty Maven repository and the configured GitHub server, then runs both MVC/WebFlux hosts and offline compilation without building/installing project JARs. Installed project files must match the accepted hashes and Maven's origin markers must identify the GitHub repository. JavaScript tooling only creates the documentation fixtures. Temporary settings/cache cleanup runs even on failure.

The native Maven deployment path has also copied all nine real local candidate files unchanged into an owned file-protocol repository. Both fresh installed hosts and their offline compilations pass using a new external Maven cache; all five installed project POM/binary files match accepted hashes and Maven's actual resolver markers. This validates standard Maven deployment, consumption and byte preservation, not GitHub registry acceptance.

## Container promotion and final acceptance

The protected OCI job loads the tested Docker archive, verifies its immutable configuration ID and promotes only its version tag. It signs a separate promotion predicate that binds the source, original producer, accepted archive and registry digest. The publisher does not claim to have built the image. A fresh anonymous consumer verifies the version tag/digest, pulls the same configuration ID, verifies the promotion attestation and runs a constrained read-only runtime probe with owned cleanup. New GHCR packages must also be public for anonymous acceptance.

The aggregate fails if any required distribution consumer fails, is cancelled or is skipped. Cross-registry publication is not atomic: inspect retained receipts after a partial failure. Never rebuild, overwrite a conflicting version, edit a generated plan or announce a complete release from a partial run. GitHub release announcements remain a separate maintainer action. The transport helpers retain their standalone npmjs/Central tests, but the configured workflow targets GitHub Packages.
