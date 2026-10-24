import { expect, it } from 'vitest';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import { databaseOptions } from '../apps/server/src/database-options.js';

it('rejects invalid timeout and migration options before opening database resources', () => {
  for (const options of [
    null,
    [],
    { migrate: 'yes' },
    { statementTimeoutMs: 0 },
    { statementTimeoutMs: 99 },
    { statementTimeoutMs: 300001 },
    { statementTimeoutMs: NaN },
    { statementTimeoutMs: Infinity },
    { statementTimeoutMs: 100.5 },
    { statementTimeoutMs: null },
    { statementTimeoutMs: '1000' },
    { queryTimeoutMs: 10000 },
    { queryTimeoutMs: 9999 },
    { queryTimeoutMs: 360001 },
    { queryTimeoutMs: NaN },
    { queryTimeoutMs: null },
    { queryTimeoutMs: '15000' },
  ])
    expect(
      () =>
        new PostgresRepository(
          'postgresql://fixture@127.0.0.1/unused',
          options as never,
        ),
    ).toThrow();
});
it('reads explicit operator timeouts without mutating the environment or echoing invalid values', () => {
  const environment = {
    DATABASE_STATEMENT_TIMEOUT_MS: '1000',
    DATABASE_QUERY_TIMEOUT_MS: '2000',
    ROOT_TOKEN: 'private-fixture',
  };
  expect(databaseOptions(environment)).toEqual({
    statementTimeoutMs: 1000,
    queryTimeoutMs: 2000,
  });
  expect(databaseOptions({})).toEqual({});
  expect(environment).toEqual({
    DATABASE_STATEMENT_TIMEOUT_MS: '1000',
    DATABASE_QUERY_TIMEOUT_MS: '2000',
    ROOT_TOKEN: 'private-fixture',
  });
  for (const raw of ['', '0', '1e3', '-1', '1.5', ' 1000', 'private-fixture']) {
    expect(() =>
      databaseOptions({ DATABASE_STATEMENT_TIMEOUT_MS: raw }),
    ).toThrow('Database timeouts must contain integer milliseconds');
  }
});
