# ADR 0002: Defer independent reviews for prerelease distribution

Status: accepted by the repository owner for prereleases.

Date: 2026-10-24.

## Context

The owner explicitly requested that the independent security, isolation, accessibility, license reviews and external pilots be skipped for now, while work continues toward a usable release. The existing publication policy represented reviews only as boolean approvals and could not express this decision without falsely recording completed reviews.

The signed `v0.2.0-candidate.2` passed all 22 candidate jobs and verified all 39 producer-attested subjects. Its read-only publication preview passed; it did not publish distributions. Main Quality and the hosted mock demo also passed. This evidence does not establish completion of the independent reviews or real registry installation.

## Decision

Source policy schema 3 records each review as `pending`, `approved` or `deferred`. A deferral records the source repository owner, a public reason and a `prerelease` scope. Deferred reviews do not block a prerelease, but remain blockers for stable versions. Pending reviews always block publication. Unrecognized statuses, missing or malformed deferral metadata, and a foreign owner fail validation.

Enable prerelease publication under this explicit owner decision. Preserve the outstanding reviews in generated plans and workflow summaries. Do not mark reviews approved, describe the project as independently reviewed, or claim a production launch from this deferral. The project was subsequently named Doctopus; this naming decision does not change the deferred review status.

Retain the normal automated gates: exact-source candidate acceptance, dependency/source/container severity checks, producer and promotion attestations, repository protections, protected publishing, public visibility and fresh registry consumers. A changed policy requires a new clean-tag candidate; earlier immutable tags and their evidence remain unchanged.

## Consequences

The current prerelease can proceed to real GitHub Packages and GHCR distribution acceptance without waiting for independent review reports. Fresh consumers must still verify and install the exact original bytes. Public package visibility may require an owner action after first publication.

The five reviews remain unfinished. A stable release requires their actual outcomes and a new matching policy/candidate. Source-policy acceptance remains distinct from GitHub environment approval and successful registry acceptance. Cross-registry publication is not atomic; retained receipts and idempotent matching-byte reuse remain required after partial failures.
