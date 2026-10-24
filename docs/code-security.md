# Source security checks

Quality and the prepared release rehearsal require CodeQL analysis of JavaScript/TypeScript and Java. The reusable workflow also runs weekly and supports manual dispatch. The Java job compiles the real core and Spring integration with Maven; JavaScript/TypeScript uses source extraction. The pinned CodeQL action runs the `security-extended` query suite and uploads findings to GitHub code scanning. Fork checks need no project secrets.

The independent severity check reads the current SARIF output after successful analysis. It blocks security findings rated 7.0 or higher (High/Critical), includes existing findings rather than only newly introduced results, and rejects suppressed results, unresolved rule references and missing or malformed security severities. Medium, low and nonsecurity results remain visible in retained reports. Failed or skipped analysis cannot satisfy the aggregate Quality or rehearsal gate.

Both language jobs retain the raw SARIF and a checksum-bound assessment for fourteen days, including when the severity check fails. An extraction or analysis failure can have no SARIF and remains a failed job. A successful empty assessment establishes only the result of those queries over that extraction; it does not replace independent code review, penetration testing, dependency/container scanning or isolation review. GitHub alerts can add investigation context but dismissal does not waive the local severity policy.

To assess current CodeQL output locally, use the pinned Node version:

```sh
node scripts/check-code-scanning.mjs path/to/javascript.sarif path/to/java.sarif
```

The command reads regular SARIF files of at most 64 MiB each, verifies their structure, records SHA-256 hashes and writes `.doctopus/code-scanning-evidence.json`. It returns a failing exit status for blocking findings or invalid input. It does not run the analyzer or establish the authenticity of arbitrary supplied reports. CI requires the preceding pinned analyzer step as well as this assessment.

The prepared rehearsal analyzes the checked-out source commit; its metadata preparation changes distribution versions but does not replace source security analysis. Before public launch, owners must verify the required aggregate checks in repository protection. CodeQL support and repository settings also need verification for private deployments/forks under their applicable GitHub licensing.

The [triage record](security-triage.md) lists the initial findings, implemented changes and validation still required. The SARIF reader uses a bounded regular-file descriptor and hashes the exact bytes assessed; file replacement between separate size-check and read operations cannot change that snapshot.
