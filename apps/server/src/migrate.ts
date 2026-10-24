import { databaseOptions } from './database-options.js';
import { readFile } from 'node:fs/promises';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
async function migrate() {
  const connection =
    process.env.DATABASE_URL ??
    (process.env.DATABASE_URL_FILE
      ? (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).replace(
          /\r?\n$/,
          '',
        )
      : undefined);
  if (!connection)
    throw new Error(
      'DATABASE_URL or DATABASE_URL_FILE is required for migration',
    );
  const repository = new PostgresRepository(connection, {
    ...databaseOptions(process.env),
    migrate: true,
  });
  try {
    await repository.initialize();
    if (process.env.DB_RUNTIME_ROLE)
      await repository.grantRuntimeRole(process.env.DB_RUNTIME_ROLE);
    console.log('Database migration and runtime grants completed.');
  } finally {
    await repository.close();
  }
}
void migrate().catch(() => {
  console.error(
    'Database migration failed. Check migration credentials, database connectivity and schema ownership.',
  );
  process.exitCode = 1;
});
