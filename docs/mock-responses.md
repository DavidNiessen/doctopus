# Local mock responses

The playground's request pane has a **Mock response options** disclosure. The response pane is reserved for the response editor, status and headers. Choose a documented status, media type, inline/named example or generated schema data, then select **Generate mock response**. This local action does not contact the API, require credentials or use the request inputs. With the default live mode, the Unified URL bar's Send action makes a real browser request with the normal confirmation rules. Projects can instead set `explorer.mode: mock` so **Send mock** also generates local data and live transport, authentication and relay controls are unavailable. See the [static GitHub Pages demo](pages-demo.md).

The viewer labels the result **Mock response** and identifies whether it came from an example, schema or empty status. It uses the same read-only Monaco editor, folding, syntax highlighting and full-body copy control as real responses. Mock previews have no network latency metric. Closing the playground discards them; nothing is stored in browser storage or sent to a mock service.

## Examples and generation

Automatic selection prefers an inline example, then a named example. External example URLs are never downloaded. Choose **Generate from schema** to override a published example. A seed of up to 128 characters makes synthetic data repeatable for the same schema and generator version. Changing the seed can change generated IDs, values and enum choices; it does not alter explicit examples, constants or defaults.

The generator supports ordinary objects, arrays, primitives, local references and compatible bounded object `allOf` composition. It honors basic length/count/numeric bounds, integer multiples, enum/const/default/example annotations, response write-only exclusion and common date/time, UUID, email, URI and IP formats. It supports OpenAPI 3.0 reference/exclusive-bound rules and 3.1 rules. Schema output is limited to 500 visited nodes, eight levels, 50 object fields, eight required array items and 256 required string characters. Large optional upper bounds do not allocate large values.

Generation fails explicitly for unsupported unions, conditionals, patterns, tuple/contains rules, ambiguous compositions, binary/encoded data, fractional multiples, unresolved recursion and constraints it cannot satisfy. Supply an explicit serialized example for these cases. Structured synthetic bodies require a JSON media type. Non-JSON inline string examples retain their original text, including HTML/XML as inert editor content.

Mock numbers must be finite and retain safe JavaScript integer precision. The preview does not fabricate exact large-integer wire data from an already rounded JavaScript number. Explicit examples are bounded to 10,000 nodes, 32 levels and a final 2 MiB response. Mock generation is a learning aid, not full schema-instance validation or evidence that a live API implements its contract.

HEAD, informational, 204, 304 and content-free responses have empty bodies. A declared `2XX` range uses 200 for the preview; other ranges use their class's first code. A `default` response uses 200. The documented selector remains visible in the mock label. The only synthesized response header is the selected Content-Type; cookies and other transport headers are not applied to the browser.

## Explorer SDK

```ts
import { generateMockResponse } from '@davidniessen/doctopus-explorer';

const preview = generateMockResponse(operation, {
  response: '200',
  contentType: 'application/json',
  exampleId: 'generated', // or inline / named:<example-name>
  seed: 'integration-demo',
  schemas: api.schemas,
  openapiVersion: api.openapiVersion,
});
// preview.kind === 'mock'; body is display/copy text, not an HTTP response.
```

This synchronous API accepts operation metadata and generation options, not credentials or a transport callback. Results contain status, documented status, media type, display headers, body and source. It does not start a persistent mock endpoint or replay requests to a server.
