# Verified release candidates

The manual **Verified release candidate** workflow collects and attests the exact npm packages, Java distributions and server image that pass their producing jobs. It does not publish registries, create tags or approve a release. Namespace ownership, independent reviews and protected publication are separate gates. [Published prerelease .7](release-acceptance.md) passed its candidate and protected registry acceptance; independent reviews remain deferred.

## Source requirements

Prepare and review unified release metadata first. The workflow must exist in the reviewed source before creating a canonical `v<version>` tag. Dispatch `.github/workflows/release-candidate.yml` from that tag. Branch dispatches, unprepared Java snapshots, mismatched versions, dirty source, moved tags and commits outside upstream `master` fail before candidate production. Full Git history is required.

The source check binds the upstream repository, exact commit, tag, version, calling workflow, run ID and run attempt. Each producer rechecks those bindings before collecting files. Ordinary branch/PR checks do not request attestations. The producer jobs declare the OIDC/attestation permissions needed by the explicit reusable-workflow release mode; publication credentials are not used.

## Exact artifacts and acceptance

The reusable Quality workflow performs its normal source, npm-consumer, browser, Java/Spring, pnpm, server, Docker, source-security and image-security checks. The release workflow additionally requires the full Chromium/Firefox/WebKit matrix and compiler/browser performance budgets.

- **npm:** all public workspace tarballs, their inventory, installed-consumer result, consumer lockfile and SBOM. Package names, versions, byte counts, SHA-256 and npm SHA-512 integrity must agree. Installed types, both Node hosts, dependency audit and offline reinstall must have passed.
- **Java:** the baseline Java 21 / Boot 3.5.16 producer retains both runtime JARs, four source/Javadoc JARs, all three POMs and the bound SBOM. Both installed MVC/reactive hosts and offline compilation must pass. The broader Java matrix remains required. No Maven rebuild occurs during collection.
- **Container:** Docker exports the exact immutable configuration ID accepted by deployment and vulnerability checks into `server.tar.gz`. Raw inventory/findings and deployment, upgrade, isolation and worker receipts accompany it. The archive is a transport artifact; a registry manifest digest and registry signature are later publication concerns.

Collection rejects dirty/stale candidate reports, ambiguous previous candidate directories, missing components, changed checksums and unsafe filenames. Every bundle has a sorted `release-assets.json` recording source/run bindings and every file's size and SHA-256. Small files are copied from one bounded regular-file read; large archives are hashed through one inspected descriptor with a four-GiB bound. Symbolic links and special files are refused.

## Producer provenance and verification

The SHA-pinned GitHub provenance action runs inside each producing job. It attests the retained files, including their bundle manifest; a later collection job does not claim to have built them. Separate artifacts retain the producer's Sigstore bundle. Build provenance records origin and build identity; it is not security or publication approval.

The final job downloads only the three named artifacts from the current run/attempt. It rejects unlisted files and verifies their bytes and complete source context. For every file, GitHub CLI then verifies the upstream repository, reusable producer workflow, exact source tag/commit and GitHub-hosted runner identity. Verification results are retained separately. An unavailable verifier or invalid/missing attestation fails the workflow.

Use **rerun all jobs** after a failure: partial reruns cannot silently mix artifacts from different attempts. Candidate and verification artifacts are retained for 14 days. Download them before expiry; a new run produces a new candidate set requiring review. A tag name alone does not establish authenticity: verify provenance and reviewed subject digests.

## Validation status

Local tooling tests exercise clean-tag/ancestor checks, identity substitutions, moved tags, dirty source, snapshots, exact npm/Java collection, missing consumer checks, tampering, stale attempts, extra files, symlinks, archive bounds and ambiguous candidates. A separate prepared `0.2.0` clone exercises real npm packing/installed consumers and collection, plus both installed Java 21 / Boot 3.5.16 hosts (eight tests and two offline compilations) and collection of all six JARs, three POMs and the SBOM. Its local fixture tag remains unpublished; the main checkout is unchanged.

The actual clean-tag [candidate run 40043580095](https://github.com/DavidNiessen/doctopus/actions/runs/40043580095) passed at `v0.2.0-candidate.1` / `c380ae159983025a519bbe706ecec049b755e8d8`, including all required Quality, Java/Spring, browser and performance jobs. Its three producers issued GitHub OIDC-backed attestations, and final verification accepted all 39 subjects against their exact bytes, source tag/commit and hosted producer identity. The nonpublishing fresh image scan also passed. Local fixture results remain separate from this hosted evidence.

The default read-only [publication plan 40045907895](https://github.com/DavidNiessen/doctopus/actions/runs/40045907895) independently verified that earlier candidate and passed with ten explicit source-policy blockers; every publishing job was skipped. Later .7 acceptance passed original Maven producer verification and registry-image promotion attestation under the selected GitHub Packages policy; no production OpenPGP key is required. Candidate and read-only workflows supply reviewable bytes and destinations, not publication approval. See the [publication planner](publication-plans.md).
