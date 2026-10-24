import type { SiteData } from '@davidniessen/doctopus-contracts';

/** Small overview pages keep large API schemas out of the collapsed reference list. */
export function* operationIndexAssets(
  site: SiteData,
): Generator<[string, string]> {
  for (const [index, api] of site.apis.entries()) {
    const root = `api-index/${index}/`;
    api.operationIndex = root + 'catalog.json';
    const pageSize = 100;
    yield [
      api.operationIndex,
      JSON.stringify({
        schemaVersion: 1,
        apiId: api.id,
        version: api.version,
        total: api.operations.length,
        pageSize,
        pages: Math.ceil(api.operations.length / pageSize),
      }),
    ];
    for (let offset = 0; offset < api.operations.length; offset += pageSize)
      yield [
        root + offset / pageSize + '.json',
        JSON.stringify({
          schemaVersion: 1,
          apiId: api.id,
          version: api.version,
          page: offset / pageSize,
          operations: api.operations
            .slice(offset, offset + pageSize)
            .map((operation) => ({
              slug: operation.slug,
              method: operation.method,
              path: operation.path,
              summary: operation.summary.slice(0, 1024),
              tag: (operation.tags[0] ?? 'Endpoints').slice(0, 256),
              deprecated: operation.deprecated,
              ...(operation.kind ? { kind: operation.kind } : {}),
            })),
        }),
      ];
  }
}
