# ADR 0003: Bind protection snapshots to live GitHub revisions

Status: implemented and verified with the read-only workflow token.

Date: 2026-10-24.

## Context

The signed `.5` candidate and read-only publication preview passed. Confirmed publication run [40103828095](https://github.com/DavidNiessen/doctopus/actions/runs/40103828095) then stopped before registry writes: GitHub omits ruleset bypass actors from the workflow token's response. The administrator connection can inspect them, but the ordinary `GITHUB_TOKEN` cannot. Treating a missing list as empty would misrepresent unknown configuration and weaken the guard.

## Decision

Generate `publication-protections.json` using an administrator-readable GitHub CLI connection. The generator validates the actual protections and captures only the repository, ruleset identities, GitHub-maintained update revisions, visible conditions/rules and the validated bypass lists. Commit the public snapshot with the release source. It contains no credentials.

Before publication, read GitHub's live metadata and require exact agreement with the snapshot's repository, rule IDs, names, source type, update revisions, conditions and rules. Validate every captured protection, including positive approving-review counts, stale approval dismissal, strict Quality checks and administrator-only bypasses. Compare bypass lists directly whenever GitHub exposes them. Missing revisions, malformed metadata, visible bypass mismatches or any configuration drift fail closed.

When GitHub redacts the actor list, the guard relies on the source-reviewed administrator snapshot and its exact live revision binding. Receipts explicitly distinguish that evidence from live actor visibility; they do not claim independent live enumeration of a redacted field. The protected release environment's reviewer/tag policy is still inspected directly on every run, and its native approval remains required.

A read-only manual/daily workflow verifies these same protections and retains actual observations, including drift failures. Existing source signatures, security gates, package permissions and installed-consumer acceptance remain unchanged. No additional Actions secret or administration-write capability is introduced.

[Workflow 40105494720](https://github.com/DavidNiessen/doctopus/actions/runs/40105494720) passes at `6b466c7` using only content/action read permissions. Both bypass lists are reported as hidden, and the receipt records the matching source snapshot, live revisions, reviewer/tag policy and original protection checks. This verifies the intended read-only path; actual registry acceptance remains separate.

## Trust and maintenance

The committed snapshot is trusted release policy, protected by the same source review/tag controls as the publication scripts themselves. GitHub's maintained update revision binds hidden settings to that reviewed state; the workflow does not independently recover hidden actor lists. Review snapshot diffs as release-policy changes. The generator refuses redacted input, and the original full-metadata validator still rejects missing bypass lists.

Changing either ruleset requires a fresh administrator-readable snapshot, a reviewed commit and a matching new candidate. The workflow refuses to silently update or refresh its own expected policy. A renamed/transferred repository also needs matching source metadata. Independent launch reviews remain deferred only as recorded in ADR 0002; this decision does not turn them into approvals.
