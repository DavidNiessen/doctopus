# Request serialization

The API playground and generated snippets use the same prepared URL, headers and body. Path, query and header values follow the operation's parameter definitions. Enter arrays and flat objects as JSON; enter scalar schema values as text. Required parameters start with an authored example or an illustrative generated value. By default, nonempty inputs are included and blank inputs are omitted. The browser UI derives presence from the input; advanced SDK callers can explicitly select empty-value serialization.

## Required and optional inputs

The playground displays only parameter fields declared by the operation. Required path, query and header values must be filled before **Send** is enabled; missing inputs show an inline error and a summary. Optional values are included when nonblank and removed when cleared. Nonempty text retains its original whitespace, encoding and declared serialization rules. Zero and false remain valid values.

There are no inclusion checkboxes, remove/restore buttons or custom-parameter insertion controls. Empty parameter sections and request-body editors that the operation does not define are hidden. Same-named parameters remain independent by location. Authentication and generated Accept/Content-Type headers retain their dedicated controls. Drafts remain in memory for the open playground, separate from appearance preferences.

## Programmatic serialization controls

The lower-level SDK retains its explicit serialization controls for custom integrations. They are not exposed by the spec-driven playground.

SDK callers can provide an optional `parameterPresence` map to `prepareRequest`, using the same `in:name` keys as `parameters`:

```ts
const request = prepareRequest(operation, api.securitySchemes, {
  server: 'https://api.example.com',
  parameters: { 'query:trace': '', 'header:trace': 'retained draft' },
  parameterPresence: { 'query:trace': true, 'header:trace': false },
  schemas: api.schemas,
  openapiVersion: api.openapiVersion,
});
```

An absent flag preserves automatic inclusion of nonempty input. `true` includes even empty text; `false` omits an optional value before parsing its draft and rejects omission of a required parameter. Flags must be own boolean properties of a record. `canSerializeEmptyParameter(parameter, { schemas, openapiVersion })` reports whether empty text has a supported parameter representation before URL-level checks. Neither inclusion nor this helper bypasses cookie, forbidden-header, reserved-header or URL policies.

cURL snippets use `--header 'trace;'` for an empty custom header; `trace:` would remove that header in cURL. Generated clients in all five languages are executed against a loopback server with empty headers, alongside the existing body, multipart and error/redirect cases.

## Programmatic additional parameters

The browser playground does not accept ad hoc query/header rows. Applications using the serializer directly can still use its typed additional-parameter API, with their own validation and access policy.

SDK callers can supply the same literal rows to `prepareRequest`:

```ts
additionalParameters: [
  { in: 'query', name: 'tag', value: 'blue' },
  { in: 'query', name: 'tag', value: '' },
  { in: 'header', name: 'trace', value: 'request-123' },
  { in: 'query', name: 'draft', value: 'not sent', enabled: false },
];
```

The optional `enabled` flag must be a boolean and defaults to true. Blank names are insertion drafts and are ignored. Hosts can use `redactAdditionalParameters` when building previews; retain the original rows only for the live request.

## Supported styles

| Location | Styles                            | Structured values                                                                        |
| -------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| Path     | `simple`, `label`, `matrix`       | Flat arrays and objects, with or without `explode`                                       |
| Query    | `form`                            | Repeated array values and exploded object keys; comma-separated values when not exploded |
| Query    | `spaceDelimited`, `pipeDelimited` | Flat arrays or objects with `explode: false`                                             |
| Query    | `deepObject`                      | Flat objects; explicit `explode: false` is rejected                                      |
| Header   | `simple`                          | Comma-separated arrays and objects, including exploded key/value pairs                   |

The default style is `simple` for paths/headers and `form` for query parameters. `form` defaults to exploded values; other styles default to un-exploded values. `deepObject` uses its bracketed object representation when `explode` is omitted. Nested collections have no defined representation under these styles and fail explicitly; describe them using parameter `content` instead. Empty exploded query collections also fail explicitly.

Data values use RFC 3986 percent encoding independently of style delimiters. For example, an un-exploded query array containing `a,b` and `c` produces `color=a%2Cb,c`. Space and pipe delimiters use `%20` and `%7C` for portable URLs. Numeric tokens in entered collections retain their original text, including large IDs and exponent notation. Appending query API-key authentication preserves that distinction. Browser URL processing must not normalize a path value to `.` or `..`; those values fail before a request is sent.

With `allowReserved: true`, query values retain reserved characters that can remain inside a query value, and valid pre-encoded `%HH` triples pass through unchanged. Raw `&`, `#`, `+`, `=`, `[` and `]` require pre-encoding because they could change query/form parsing or produce invalid URI syntax. The browser can still normalize individual characters, such as an apostrophe in an HTTP URL. This is a deliberate safety boundary, not support for ambiguous reserved-character expansion. With `allowReserved` false, percent signs are ordinary data and are encoded too.

## Content-based parameters

A parameter can declare exactly one media type in `content`. JSON and `+json` inputs are syntax-checked and compacted once, then encoded as one path/query value or sent as the header value. Compaction preserves numeric tokens and string escapes, including integers beyond JavaScript's safe range. JSON strings require quotes. Non-JSON content is already serialized text and retains its whitespace before URL encoding. Content-based values do not apply schema-style delimiters. External examples are never fetched.

Referenced parameter schemas resolve against the API's schema map, retaining the OpenAPI 3.0/3.1 reference-sibling behavior. Programmatic `prepareRequest` callers should provide `schemas: api.schemas` and `openapiVersion: api.openapiVersion`; an unresolved schema reference fails instead of silently serializing an array as text. Serialization is not complete schema-instance validation, and advanced union/conditional schemas still need review.

## Browser constraints

Cookie parameters cannot be set manually. Browser-controlled headers, invalid names, control characters and values outside the browser's header character range fail explicitly. OpenAPI header parameters named `Accept`, `Content-Type` or `Authorization` are ignored as required by the format; use media selection and security schemes instead. Header names are handled without case-sensitive duplicates, including API-key authentication.

The API must permit the request through CORS. Requests omit browser cookies and refuse redirects. The reader asks before potentially destructive methods. JSON object bodies support [schema-aware field editing](explorer-bodies.md) with a raw editor for exact control. [Form-urlencoded bodies](form-bodies.md) support logical values and literal encoded text in both the reader and SDK. Binary/text/JSON [multipart uploads](multipart-bodies.md) are also supported. Streaming remains separate work.

The parameter suite checks the style/explode combinations, content parameters, referenced schemas, delimiter-sensitive values and error boundaries. A loopback HTTP fixture also verifies the actual URL and header bytes received by a server.

Fetch-bound headers use iterable entries rather than JavaScript object literals. The SDK fetch adapter and generated JavaScript/TypeScript clients capitalize the transport spelling of `__proto__` to `__Proto__` to avoid a lowercase dictionary collision in the pinned Node.js fetch implementation; HTTP field names are case-insensitive. Loopback tests inspect raw wire headers to verify this field is transmitted.
