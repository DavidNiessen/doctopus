import type { PostgresRepositoryOptions } from '@davidniessen/doctopus-storage';

/** Operator values only; credential strings never enter error messages. */
export function databaseOptions(
  environment: Record<string, string | undefined>,
): Pick<PostgresRepositoryOptions, 'statementTimeoutMs' | 'queryTimeoutMs'> {
  const options: Pick<
    PostgresRepositoryOptions,
    'statementTimeoutMs' | 'queryTimeoutMs'
  > = {};
  for (const [name, key] of [
    ['DATABASE_STATEMENT_TIMEOUT_MS', 'statementTimeoutMs'],
    ['DATABASE_QUERY_TIMEOUT_MS', 'queryTimeoutMs'],
  ] as const) {
    const raw = environment[name];
    if (raw === undefined) continue;
    if (!/^[1-9]\d*$/.test(raw))
      throw new Error('Database timeouts must contain integer milliseconds');
    options[key] = Number(raw);
  }
  return options;
}
