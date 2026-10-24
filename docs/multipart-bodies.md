# Multipart request bodies

The reader and explorer SDK prepare bounded, binary-safe `multipart/form-data` requests. All five snippet generators support uploads.

## Reader inputs

The playground separates local file selectors from text values. Declared binary arrays accept multiple files; each selected file becomes its own part. Use Fields or JSON for text/JSON values, including exact numeric tokens. Examples can describe a file field but cannot select a visitor's local file: binary example placeholders are removed from the text draft, and required uploads remain disabled until a file is chosen. Do not place binary fields or encoded file contents into the text JSON object.

The reader caps its controls at 100 declared properties. It blocks invalid JSON, missing required parts, unsupported codecs and requests above the aggregate size/part limits. Response-only properties are not required in requests. Each file field has a clear control; changing the API server, content type, example or operation clears file selections. Selections remain while editing in the open playground; closing it, navigation and reload discard them. The reader sends files directly to the API only after Send request and the normal mutating-request confirmation.

Previews retain ordinary text/plain and JSON values while redacting password/write-only annotations, nested JSON values and known credentials. File bytes and original filenames are always replaced. Opaque non-JSON structures use a whole-part placeholder because their nested values cannot be safely interpreted by the JSON schema redactor. Missing, invalid or excessive redaction contexts fail closed. This annotation-based protection still requires reviewing an example before executing it.

## SDK

Supply logical text values as a JSON object, and selected files separately. File fields declare `format: binary`, directly or inside array items. Arrays of files and arrays of text/JSON values repeat the part name. The encoder resolves local root, property and item references using the API's schema map and dialect.

```ts
import {
  prepareRequest,
  toFetchRequest,
} from '@davidniessen/doctopus-explorer';

const request = prepareRequest(operation, api.securitySchemes, {
  server: 'https://api.example.com',
  parameters: {},
  contentType: 'multipart/form-data',
  bodyFormat: 'json',
  body: '{"title":"Example upload","metadata":{"id":9007199254740993}}',
  files: {
    attachment: [{ data: selectedFile, filename: selectedFile.name }],
  },
  // When declared by encoding.attachment.headers:
  partHeaders: { attachment: { 'X-Checksum': 'reviewed-checksum-value' } },
  schemas: api.schemas,
  openapiVersion: api.openapiVersion,
});
const response = await fetch(request.url, {
  ...toFetchRequest(request),
  credentials: 'omit',
  redirect: 'error',
  signal: AbortSignal.timeout(30_000),
});
```

`selectedFile` is a browser `File` or another `Blob`; the SDK does not read filesystem paths. `prepareRequest` returns `multipart` parts instead of a string `body`. Use `toFetchRequest` to materialize the actual fetch method, standard `Headers` instance and Blob body. Inspect a returned header with `.headers.get(name)`. Each invocation creates a fresh cryptographically random boundary and matching Content-Type header. Do not provide a boundary or other outer media-type parameters. Files remain immutable Blob slices during preparation and assembly; the encoder never decodes them as text. Preparation uses no clock or randomness, making request previews deterministic.

Text primitives use UTF-8 `text/plain`; objects use JSON. Explicit per-field `encoding.contentType` selects one concrete media type. Non-JSON structured fields require already serialized text. JSON parts have a content type and no filename; they are not disguised as uploaded files. File parts default to `application/octet-stream`; an explicit encoding can select another type. No content sniffing, base64 decoding or XML conversion occurs. Exact numeric tokens in logical JSON remain intact.

`createMultipartParts(body, files, media, options)` exposes preparation independently. `MULTIPART_LIMITS` publishes the 100-part, 32-MiB aggregate and 1,024-byte field-name/filename limits. The aggregate limit includes conservative space for headers and boundaries. Logical JSON also obeys the shared [JSON input limits](explorer-bodies.md). Oversized requests fail before file bytes are read. Single-file fields reject multiple files; required request fields need at least one emitted part, while read-only properties are exempt. Content-based empty arrays emit no part. A binary field cannot also appear in the logical text object. GET/HEAD uploads and files supplied for other body media types fail explicitly.

## Explicit style encoding

In OpenAPI 3.1, an explicit `style`, `explode` or `allowReserved` selects the shared query-style codec instead of content-based serialization. Supported styles are `form`, `spaceDelimited`, `pipeDelimited` and flat `deepObject` with explode enabled. Arrays/objects must contain scalar values. Numbers retain their original lexemes. An explicit style field, including `explode: false` or `allowReserved: false`, overrides `contentType`; these parts use `text/plain; charset=utf-8`.

For example, `tags: { style: form, explode: false }` turns `{"tags":["a+b",9007199254740993]}` into one `tags` part containing `a%2Bb,9007199254740993`. Exploded objects use their keys as part names; deep objects use bracketed names. The part body uses the query codec's RFC3986 escapes and delimiters, without `?`, `=` or `&` framing. Field names remain ordinary Content-Disposition names, subject to the existing Unicode/control/size rules. Custom headers and required-part checks remain attached to the original logical property even when it expands into differently named parts. Colliding names from separate logical properties fail explicitly.

This follows the [OpenAPI 3.1.1 Encoding Object and Appendix C](https://spec.openapis.org/oas/v3.1.1.html#encoding-object). That specification warns about interoperability when using URI-style encoding inside multipart data. Ordinary multipart parsers return these encoded values as text; the API must implement the declared style decoding. Use content-based parts for ordinary UTF-8/JSON/file behavior. Binary uploads with explicit 3.1 style fields require a custom client. Undefined empty exploded collections, nested styled values, unsupported styles and unsafe reserved-character expansion fail explicitly.

OpenAPI 3.0 requires these multipart style fields to be ignored, so that dialect retains content-based text, JSON and file parts. Pass `openapiVersion` when calling the SDK directly; its default behavior is 3.1.

Copied previews replace every styled value with `YOUR_PART_VALUE`, even when a body redaction context is available. This avoids guessing nested sensitivity annotations from flattened/encoded wire data. Actual requests retain the entered values. The SDK marks these parts with `styled: true`; preserve that metadata when transforming requests before redaction. Content-based parts retain the existing selective annotation redaction.

## Boundaries and safety

The codec supports direct object roots, compatible `allOf` object roots and content-based encoding. The shared reader/SDK projection merges disjoint properties and required fields, resolves local references with the API's dialect rules and preserves read-only/sensitive annotations. It is bounded to 32 schema nodes and eight composition levels; upload controls, example file removal and snippet redaction use the same projected fields.

Overlapping properties, closed/additionally constrained composition branches, unions, conditionals and unresolved/excessive compositions require a custom client. This is a serializer with presence checks, not full schema-instance or file-content validation. Configure API-side size limits, authorization and file validation separately.

## Custom part headers

Declare MIME extension headers in `encoding.<field>.headers`, using Header Objects or local Header Object references. The playground adds inputs for those definitions, initially empty. Empty values omit a header; a required header needs a value only when its part is emitted. One field's values apply to every repeated text/file part with that field name. Changing the server, content type or selected example clears header drafts; closing the playground, navigation and reload discard them. Direct password/write-only annotations and familiar secret-bearing header names use masked inputs. Header examples remain descriptive and are not implicitly sent.

SDK callers pass `partHeaders` to `prepareRequest`, or as `createMultipartParts`' fourth-argument option. Names match case-insensitively; duplicate spellings and undeclared nonempty inputs fail. Header schema serialization supports simple style, boolean explode, primitives and flat arrays/objects, using the same representation as ordinary header parameters. Header `content` accepts already serialized values; JSON is compacted without rounding numeric tokens. Nested structured values require JSON content rather than flat simple style. This does not perform complete Header Object schema-instance validation.

`Content-Type` declarations/values inside the encoding header map are ignored as required by OpenAPI: use `encoding.<field>.contentType` instead. Content-Disposition, Content-Length and Transfer-Encoding belong to the encoder and cannot be overridden. Custom names are ASCII HTTP tokens of at most 128 characters, and serialized values must be printable ASCII without controls. Each part permits 16 custom headers and 8 KiB of combined custom header lines; each supplied raw value is also limited to 8 KiB. The SDK accepts header values for at most 100 encoded fields; the reader caps declared header controls at 100. These bytes also count toward the 32 MiB multipart limit. `MULTIPART_HEADER_LIMITS` exposes the limits, and `multipartHeaderFields` exposes normalized definitions for custom UIs.

These are headers inside the MIME body; they do not alter HTTP transport headers, authentication policies or CORS. Header values describe the supplied bytes; setting an encoding header does not transform them. The receiving multipart parser must retain headers if the API needs their values. The compiler resolves Header Object references separately from schema references, honors 3.0/3.1 Reference Object description rules and bounds nested media/header content to eight levels. Direct SDK callers provide any referenced definitions through their portable registry.

Every copied custom header value becomes `YOUR_PART_HEADER`, including values without sensitivity annotations. Actual sending retains entered values. All five generated clients share the validated framer and carry those MIME headers; executable tests inspect received part-header bytes as well as ordinary fields and binary files.

Field names reject controls, double quotes and backslashes to avoid ambiguous Content-Disposition parsing. Filenames must be basenames without controls or path separators; quoted filenames escape `"` as `%22`, matching browser multipart behavior. Ordinary Unicode names and filenames remain UTF-8. Check a server's decoding behavior if it relies on unusual filename characters.

`redactRequest` accepts the same optional `BodyRedaction` context for multipart as JSON requests. With a valid context it reconstructs logical arrays, applies conservative annotation redaction and preserves exact JSON tokens. Uploaded bytes and filenames are always replaced; opaque parts and failures use placeholders. Without a context, all text values are replaced conservatively. The actual prepared request is unchanged. `createMultipartParts` records `collection: true` on repeated logical array parts; preserve that metadata when transforming requests. Manually constructed array parts must provide it when their schema cannot establish the grouping. `generateSnippet` supports cURL, JavaScript, TypeScript, Python and Java. JSON-part placeholders remain syntactically valid JSON strings.

## Executable snippets

Multipart snippets use numbered `./YOUR_FILE_1`, `./YOUR_FILE_2`, … paths. Replace each with a local file before execution. Selected file bytes and original filenames never enter generated source, even when the caller passes an unredacted request; generated part filenames are `upload-1.bin`, `upload-2.bin`, … . Adapt these generic names if the destination requires a particular filename. Text values come from the provided request, so call `redactRequest` before copying a preview containing sensitive values.

Each generated client creates a fresh boundary and sends Content-Type values per part, preserving repeated fields, arbitrary binary file bytes and explicit JSON parts without filenames. Native Blob assembly, standard-library publishers or private temporary body files avoid treating uploaded bytes as text. JavaScript/TypeScript file examples target the pinned Node.js 24 runtime and use `node:fs` `openAsBlob`; they do not access browser file inputs. Python uses only its standard library. Java uses file body publishers. cURL upload examples are POSIX shell scripts requiring `mktemp`, `od`, `tr`, `cat` and `base64` in addition to cURL. They create temporary bodies under a restrictive umask and clean up on exit.

The executable harness tests all five clients against a real loopback server and independently parses their multipart data. It covers text-only uploads, binary and empty files, Unicode, NUL characters, repeated values, exact numeric tokens inside JSON, per-part types, generic filenames, HTTP failures and redirects that must not issue another request. These 20 multipart checks run alongside the existing 40 snippet cases.

Five additional executable cases, one per language, verify explicit styled multipart fields over real loopback HTTP with independent parsing. Tests also cover binary octets, Unicode, repeated fields/files, large JSON numbers, per-part content types, boundary freshness, injection attempts, limits and redaction. See [form-urlencoded bodies](form-bodies.md) for the separate text-form codec.
