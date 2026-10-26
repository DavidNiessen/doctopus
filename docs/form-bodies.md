# Form-urlencoded request bodies

The reader and explorer SDK can encode logical JSON values into `application/x-www-form-urlencoded` bodies. The reader also accepts literal encoded text for full control.

## Reader inputs

Choose **Form values** to edit declared fields or their logical JSON object. Numbers retain their exact tokens; arrays, objects and explicit encoding settings become the encoded request shown in the snippet. Password and write-only values are redacted in that snippet, while sending uses the actual values.

Choose **Encoded body** to provide the exact wire text. On its first use after Form values, it starts with the encoded form draft. Each input subsequently keeps its own draft: switching back restores that input's previous text. Encoded edits are not decoded into typed fields; if no form-values draft exists, it starts empty. A selected example or content type starts fresh drafts. Object examples open as form values; serialized string examples open as encoded text.

Literal encoded-body snippets use `YOUR_REQUEST_BODY` because arbitrary encodings cannot be safely reconstructed for schema redaction. Inspect or deliberately copy the actual text in the encoded-body editor when needed. Drafts remain while editing in the open playground; closing it, navigation and reload discard them. See [JSON field editing](explorer-bodies.md) for syntax limits, incomplete edits and sensitive values.

The reader omits blank optional values and blocks sending when required values are missing. It only accepts fields declared by the request schema; use the labeled fields or JSON to correct the highlighted request errors. These UI rules also apply to literal encoded text. The SDK remains a lower-level serializer with its documented encoding behavior.

## SDK

Pass `bodyFormat: 'json'` to `prepareRequest` with a declared form content type, the logical object in `body`, and the API's `schemas` and `openapiVersion`. The returned body is the encoded wire text used by every snippet generator. The default `bodyFormat: 'serialized'` keeps an already encoded body literal.

```ts
const request = prepareRequest(operation, api.securitySchemes, {
  server: 'https://api.example.com',
  parameters: {},
  contentType: 'application/x-www-form-urlencoded',
  bodyFormat: 'json',
  body: '{"name":"Example + team","enabled":false}',
  schemas: api.schemas,
  openapiVersion: api.openapiVersion,
});
// request.body: name=Example+%2B+team&enabled=false
```

`encodeFormBody(body, media, options)` exposes the same encoder directly. It retains exact numeric tokens, including large IDs. Syntax, duplicate-key, byte, node and depth limits match the [JSON field editor](explorer-bodies.md).

## Content and style encoding

The encoder follows the distinction described by the [OpenAPI 3.1.2 Encoding Object](https://spec.openapis.org/oas/v3.1.2.html#encoding-object):

- When no `style`, `explode` or `allowReserved` field is explicitly present, content-based encoding applies. Objects become compact JSON. Primitive values use text. Arrays repeat the field name for each item, applying the item content type; empty arrays produce no pair.
- `encoding.<field>.contentType` can select JSON/`+json` for quoted strings or structured values. Other media types require already serialized text. Binary/base64 values must already be encoded text; the encoder does not read files or transform binary data.
- Explicit `style`, `explode` or `allowReserved` selects style-based serialization and takes precedence over `contentType`. Supported styles and flat-value boundaries match [query parameter serialization](request-serialization.md).
- Content-based fields use the browser's WHATWG form encoding, including `+` for spaces and `%2B` for a literal plus. Style-based fields preserve their delimiters and use `%20` for spaces. Both decode correctly as form data.
- Text-style null values become an empty value (`name=`). Explicit JSON content preserves the `null` token. Empty strings remain present. An empty encoded form fails when the operation requires a body.

Root and property references use the API's schema map and dialect behavior. Compatible `allOf` object roots merge disjoint properties and required-field lists using the same bounded projection as the reader's JSON fields and multipart codec. The public `objectFieldSchema(schema, schemas, legacy)` helper exposes that conservative projection; it does not replace schema validation. OpenAPI 3.0 ignores reference siblings while 3.1 includes supported sibling branches. The projection accepts at most 32 schema nodes and eight composition levels.

Overlapping properties, closed/additionally constrained composition branches, unions, conditionals and unresolved/excessive compositions still require a pre-serialized body. Nested style values, unresolved references and ambiguous wildcard/multiple content types fail explicitly. Non-multipart per-field headers are ignored as required by OpenAPI. Serialization retains unknown logical values rather than silently deleting them; this is not complete schema-instance validation.

When a property/item type is omitted, the encoder infers JSON versus text from the supplied value. Use an explicit `contentType` to avoid relying on that fallback.

Reserved expansion preserves valid pre-encoded `%HH` triples. Raw `&`, `#`, `+`, `=`, `[` and `]` must be pre-encoded when `allowReserved` is true; otherwise they could change the form/query grammar. Ordinary percent signs are encoded. With `allowReserved` false, values are encoded normally, including any percent signs supplied as literal data.

See the [multipart SDK codec](multipart-bodies.md) for separate binary file inputs. Use a pre-serialized body when the contract requires a different codec or unsupported expansion. No implicit XML, custom content codec or multipart upload is advertised by this encoder.
