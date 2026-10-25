# OpenAPI compatibility

The compiler accepts OpenAPI 3.0.0–3.0.4 and 3.1.0–3.1.2 in YAML or JSON. Equivalent files produce equivalent operation models. The API version used in documentation URLs is independently configured with `specs[].version`.

## Direct framework mode

[Direct Spring and Node integrations](direct-integrations.md) load one self-contained OpenAPI 3.0/3.1 YAML or JSON document in the browser. They reuse the portable parser, semantic normalizer and compiled JSON Schema meta-validator, with local `#/...` references. They do not run the compiler's full structural OpenAPI validation, file bundling or `doctor` checks. Bundle external references before serving the document. Relative or omitted server URLs resolve against the specification URL; operation URLs and version routes come from the normalized specification.

The fetch is limited to 16 MiB and 30 seconds overall. Parsing and normalization run in a terminable worker with a ten-second deadline. The same YAML alias, node and depth bounds apply. Browser credentials, CORS and JavaScript requirements are explained in the setup guide.

The sections below describe the optional compiled-publication workflow and its additional validation tools.

## Validation and references

Inputs are structurally validated against the OpenAPI schemas. OpenAPI 3.1 schemas exposed in the compiled API graph are additionally checked against the JSON Schema 2020-12 meta-schema. The default OpenAPI 3.1 dialect and explicit 2020-12 dialect are supported; custom dialects in those schemas produce an error. This validates the schema's structure, not every authored example or its business meaning.

Dialect checks include nested schema positions: properties, definitions, compositions, arrays, conditionals, dictionaries and content schemas, including parameter/response/multipart Header Object content. Schema resource identities (`$id`), named anchors (`$anchor`), dynamic references/anchors and legacy recursive references/anchors are not implemented and fail explicitly. Ordinary JSON Pointer `$ref` recursion remains supported. The guard walks schema positions rather than literal example/default/enum data, so an API field named `$id` or an example containing `$schema` remains data. Errors identify the keyword and bounded source location without reflecting the resource URI.

Semantic checks reject duplicate operation IDs and parameters, ambiguous path templates, missing/optional path parameters, unknown security scheme names, invalid references and route collisions. Omitted responses are valid in OpenAPI 3.1 and produce a documentation warning; OpenAPI 3.0 requires them. Errors identify the source file and pointer where available. `validate --strict` fails on documentation warnings.

Local references are bundled within the real project root. Symlinks cannot escape it. Schema aliases, nested JSON Pointers, escaped pointer segments and recursive references retain a finite representation; route payloads include reachable referenced schemas. Validation siblings of `$ref` are preserved as an intersection, rather than overwriting the referenced constraints. Live HTTP resolution is disabled. An explicit [pinned reference snapshot](reference-snapshots.md) can preserve relative, transitive and recursive HTTP references by resolving only the approved local cache. This optional mode accepts plain JSON Pointer fragments and rejects URI rebasing, named anchors and dynamic-reference keywords. The explicit [remote snapshot importer](remote-import.md) can download a bounded, self-contained root document from an allowed origin before an offline build; it never fetches external references or runs automatically during compilation.

File reads are bounded before loading the full input: 16 MiB per spec/reference, 128 referenced files, and 64 MiB total source bytes. YAML rejects duplicate keys, unsupported tags, non-finite numbers, complex keys and cyclic aliases. Use OpenAPI `$ref` for recursive schemas. Finite numeric mapping keys (such as unquoted response status codes) become strings; keys that collide after conversion fail explicitly. Shared non-cyclic aliases expand to a JSON tree, bounded per source to 128 nesting levels, 1,000,000 expanded value nodes and 64 MiB of serialized JSON. Binary/non-UTF-8 files are rejected. The same parser protects configuration and guide front matter. These limits apply to source parsing; operators must still isolate untrusted builds and bound process memory and time.

## Generated documentation

| Construct               | Current behavior                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paths and operations    | Parameters, inherited/overridden parameters, request/response bodies, media types, security alternatives, server variables, source pointers and deprecation |
| Reusable definitions    | Schemas, request bodies, responses, parameters, security schemes and response headers resolve local references                                              |
| Composition             | `allOf`, `oneOf`, `anyOf`, recursion, nullable types, enums, constants, defaults and constraints appear in the schema view                                  |
| JSON Schema annotations | Metadata is preserved; the reader shows common scalar, array, read/write and discriminator constraints                                                      |
| Webhooks                | Dedicated searchable reference pages with request payload examples                                                                                          |
| Callbacks               | Dedicated pages identify the triggering operation, callback name and runtime expression                                                                     |
| Incoming events         | Explorer execution is disabled; your application's receiver handles the documented request                                                                  |

JSON request-body roots, nested properties and array items can use [explicit bounded branch selection](explorer-bodies.md#choose-a-root-schema-branch) for supported `oneOf`/`anyOf` object and array controls. This changes editing controls without validating or rewriting the body.

The schema view shows nested boolean schemas, object/array constraints, tuple positions, typed dictionaries, conditionals, property patterns and each composition keyword together with its siblings. Referenced descriptions and visibility/deprecation annotations remain visible. Values in enums use JSON notation to distinguish strings from null, booleans and numbers. Nested display stops explicitly after six levels and identifies recursive references. OpenAPI 3.0 typed `nullable` schemas add null; 3.0 reference siblings are ignored. In 3.1 use a JSON Schema null type instead.

Generated examples are labeled bounded illustrative templates. Conditional schemas, advanced array/object evaluation, automatic discriminator branch matching and arbitrary regex constraints are preserved but are not yet fully represented by interactive forms or guaranteed-valid synthetic examples. Run doctor to validate authored examples. Cookie parameters cannot be set manually by the browser explorer; host authentication or copyable client snippets require the appropriate runtime policy.

The compatibility suite covers YAML/JSON parity across both versions, semantic failures, alias/nested/circular references, `$ref` intersections, webhook/callback rendering, source limits and malformed UTF-8. Framework support and packaged consumer tests are documented in [integrations](integrations.md).

## Authored example checks

The five initial client snippets are executed against a local fixture in CI; see [snippet behavior and verification](snippets.md).

See [request serialization](request-serialization.md) for path/query/header styles, content-based parameters, referenced schemas and explicit browser limitations.

The reader and explorer offer inline and named local examples, including explicit `null`, `false`, zero and empty strings. Response examples can be switched by status and media type. External example URLs remain metadata and are never fetched automatically. When no local value exists, the reader shows a generated illustrative example. JSON media types display JSON strings with quotes; serialized text/XML examples preserve their text and whitespace. Selecting an explorer example replaces the editable request body; editing it marks the body as custom. The requested response format controls the `Accept` header independently of the reference response view. Optional authentication permits anonymous requests and uses a complete supplied credential alternative when present.

Run `doctor` for offline schema validation of authored examples, including local references, falsy values, standard formats and directional read/write-only requirements. See the [doctor coverage and limits](doctor.md). Structural import alone does not validate example data.
