# Importing remote OpenAPI snapshots

`doctopus import-spec` explicitly downloads a self-contained OpenAPI 3.0/3.1 YAML or JSON document, validates it, and saves its original bytes inside a project. Builds, doctor and preview continue using local files; they never fetch a configured URL automatically. For relative or remote external references, use [pinned reference snapshots](reference-snapshots.md) or bundle the document first. Local fragment references, including recursive schemas, are supported.

Create the destination parent directory, then import from an exact allowed origin:

```sh
mkdir -p specs
doctopus import-spec https://api.example.com/openapi.yaml . \
  --allow-origin https://api.example.com \
  --output specs/openapi.yaml
```

Reference the saved file through the ordinary `specs[].path` configuration. JSON destinations require JSON source bytes; YAML destinations accept YAML or JSON. The importer retains whitespace, number tokens and source formatting rather than rewriting the parsed object. New files have mode `0600`; replacement retains the existing permissions. The command prints the saved path, byte count and SHA-256, without printing the source URL, query or bearer token.

## Authentication, pins and refreshes

Use `--bearer-env DOCS_SOURCE_TOKEN` to read a token from an existing environment variable. It is sent only to the selected origin and is not written into project configuration. Set the value through your normal secret mechanism; URL query credentials can otherwise be visible in shell history and process listings.

Use `--sha256 <64-lowercase-hex-digits>` to require an approved digest of the exact downloaded bytes. A whitespace change changes that digest. Existing files are refused unless `--replace` is explicit. Replacement downloads and validates first, stages a same-directory file, then renames it atomically. It rejects detected changes to the destination's bytes or permissions before the final rename. New-file creation cannot overwrite a file created during the download. Failed validation, checksum checks or downloads leave the previous file untouched.

Output paths must stay inside the real project root. Parent directories must already exist; output symlinks and parent symlinks escaping the project are rejected. The destination filesystem must support ordinary same-directory atomic rename and hard-link creation.

## Spring Boot and other local generators

For an explicitly approved local springdoc endpoint:

```sh
doctopus import-spec http://127.0.0.1:8080/v3/api-docs . \
  --allow-origin http://127.0.0.1:8080 \
  --allow-http --allow-private-network \
  --output openapi.json
```

Add `--replace` for later refreshes, and `--bearer-env` if the generator is protected. The same workflow works with framework-generated self-contained OpenAPI documents from JavaScript and other runtimes. The importer does not discover arbitrary application routes or replace those frameworks' OpenAPI generators.

## Destination and resource policy

- HTTPS and globally routable unicast addresses are the default. `--allow-origin` is repeatable, with at most 16 exact scheme/host/port origins. It accepts no paths, wildcards or embedded credentials. Cleartext HTTP requires `--allow-http`.
- Every DNS answer must pass the address policy. The importer selects one approved address and pins the connection to it, retaining the original Host header, TLS server name and certificate verification. A failed connection does not fall back to an unpinned name. Mixed public/private answers fail unless all answers meet the explicitly selected policy.
- `--allow-private-network` permits loopback, RFC1918, carrier-grade private IPv4 and IPv6 unique-local addresses for the approved origins. Link-local/cloud metadata, unspecified, multicast, mapped IPv6 and reserved/documentation ranges remain denied. Deployments must also enforce their egress policy at the network boundary.
- Redirects are rejected, including same-origin redirects. Choose and allow the final source URL explicitly. Source bearer credentials cannot be forwarded through a redirect.
- DNS, downloading and isolated validation share a 30-second deadline. The default maximum body is 16 MiB, including streamed responses without a length header. Compressed responses are rejected; the request asks for identity encoding. Headers are bounded to 16 KiB.
- UTF-8 and the existing bounded YAML/JSON parser are required: at most 50 aliases, 128 nesting levels, one million values and 64 MiB of expanded JSON. Structural OpenAPI validation runs in a fresh worker with a 256-MiB old-generation heap limit. Validation excerpts and downloaded payloads are omitted from errors. This validates the document structure, not every authored example; run doctor afterward.

Configured HTTP(S) proxies and `NO_PROXY` are selected against the original origin. A proxied HTTPS connection uses the pinned IP in its CONNECT authority while keeping the original TLS identity. Proxy/egress rules must permit that secure route. A rejected or invalid proxy does not trigger a direct or unpinned fallback. Existing certificate trust remains in effect; there is no insecure-TLS option.

Programmatic callers can use `downloadSpec(url, options)` from `@davidniessen/doctopus-spec`, or `importRemoteSpec(project, url, options)` from `@davidniessen/doctopus-cli`. Their required `allowedOrigins` must come from operator-controlled policy. `RemoteSpecOptions` also accepts an abort signal and lower `maxBytes`/`timeoutMs` limits within the defaults above. The returned snapshot contains source bytes, SHA-256 and origin; it does not retain the query or authentication headers.
