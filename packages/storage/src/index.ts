import { PostgresBuildJobs, readBuildQueueLimits } from './build-jobs.js';
import { databaseError } from './database-error.js';
import type { SqlClient, SqlDatabase } from './sql.js';
import {
  migrations,
  schemaBootstrap,
  databaseSchemaVersion,
} from './migrations.js';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  OidcTransaction,
  Project,
  Publication,
  Repository,
  Role,
  RelayAudit,
  RelayAuditWriter,
  BuildJobRepository,
  BuildQueueLimits,
} from '@davidniessen/doctopus-domain';
import { ConflictError } from '@davidniessen/doctopus-domain';
const projectColumns =
  'id, slug, name, visibility, active_publication_id AS "activePublicationId"';
const publicationColumns =
  'id, project_id AS "projectId", artifact_id AS "artifactId", subject, created_at::text AS "createdAt", idempotency_key AS "idempotencyKey"';
// The runtime supports a per-query deadline; upstream QueryConfig currently
// declares query_timeout only on connection configuration.
interface TimedQueryConfig extends pg.QueryConfig {
  query_timeout: number;
}
function timedQuery(
  text: string,
  values: unknown[] | undefined,
  timeout: number,
): TimedQueryConfig {
  return { text, values: values ?? [], query_timeout: timeout };
}
export interface PostgresRepositoryOptions {
  migrate?: boolean;
  buildQueue?: Partial<BuildQueueLimits>;
  /** Per-statement server deadline, including lock waits. Runtime default: 10000 ms; migration: 60000 ms. */
  statementTimeoutMs?: number;
  /** Driver response deadline. Defaults to the statement deadline plus 5000 ms. */
  queryTimeoutMs?: number;
}
function databaseTimeouts(options: PostgresRepositoryOptions) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    (options.migrate !== undefined && typeof options.migrate !== 'boolean')
  )
    throw new Error('Invalid PostgreSQL repository options');
  const statement =
    options.statementTimeoutMs === undefined
      ? options.migrate
        ? 60000
        : 10000
      : options.statementTimeoutMs;
  const query =
    options.queryTimeoutMs === undefined
      ? statement + 5000
      : options.queryTimeoutMs;
  if (
    !Number.isSafeInteger(statement) ||
    statement < 100 ||
    statement > 300000 ||
    !Number.isSafeInteger(query) ||
    query <= statement ||
    query > 360000
  )
    throw new Error(
      'PostgreSQL statement timeout must be 100–300000 ms; query timeout must be greater and at most 360000 ms',
    );
  return { statement, query };
}
export class PostgresRepository implements Repository, RelayAuditWriter {
  readonly buildJobs: BuildJobRepository;
  private readonly pool: pg.Pool;
  private readonly queryTimeoutMs: number;
  private readonly migrate: boolean;
  private readonly relayAuditPool: pg.Pool;
  constructor(
    connectionString: string,
    options: PostgresRepositoryOptions = {},
  ) {
    const timeouts = databaseTimeouts(options);
    const queueLimits = readBuildQueueLimits(options.buildQueue);
    this.migrate = options.migrate === true;
    this.queryTimeoutMs = timeouts.query;
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      statement_timeout: timeouts.statement,
      query_timeout: timeouts.query,
      idle_in_transaction_session_timeout: timeouts.query,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });
    this.relayAuditPool = new pg.Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 4000,
      query_timeout: 5000,
    });
    const database: SqlDatabase = {
      query: <Row extends pg.QueryResultRow = pg.QueryResultRow>(
        text: string,
        values?: unknown[],
      ) => this.query<Row>(text, values),
      transaction: <T>(work: (client: SqlClient) => Promise<T>) =>
        this.transaction(work),
    };
    this.buildJobs = new PostgresBuildJobs(database, queueLimits);
    this.relayAuditPool.on('error', () => {
      /* Relay outcomes report availability without logging credentials. */
    });
    this.pool.on('error', () => {
      /* Health checks expose availability without logging connection credentials. */
    });
  }
  private async query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) {
    try {
      return await this.pool.query<Row>(
        timedQuery(text, values, this.queryTimeoutMs),
      );
    } catch (error) {
      throw databaseError(error);
    }
  }
  private async transaction<T>(
    work: (client: SqlClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect().catch((error: unknown) => {
      throw databaseError(error);
    });
    const query: SqlClient['query'] = <
      Row extends pg.QueryResultRow = pg.QueryResultRow,
    >(
      text: string,
      values?: unknown[],
    ) => client.query<Row>(timedQuery(text, values, this.queryTimeoutMs));
    let committed = false;
    try {
      await query('BEGIN');
      const result = await work({ query });
      await query('COMMIT');
      committed = true;
      return result;
    } catch (error) {
      throw databaseError(error);
    } finally {
      // Destroying a failed connection rolls back its open transaction on PostgreSQL.
      // Never reuse a client with an uncertain transaction or a timed-out query still in flight.
      client.release(!committed);
    }
  }
  async initialize(): Promise<void> {
    const check = (rows: { version: number }[], prefix = false) => {
      if (
        rows.length > databaseSchemaVersion ||
        (!prefix && rows.length !== databaseSchemaVersion) ||
        rows.some((row, index) => row.version !== index + 1)
      )
        throw new Error(
          'Unsupported database schema. Run the compatible migration job before starting the server.',
        );
    };
    if (!this.migrate) {
      const history = await this.query<{ version: number }>(
        'SELECT version FROM docs_schema_migrations ORDER BY version LIMIT $1',
        [databaseSchemaVersion + 1],
      );
      check(history.rows);
      return;
    }
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(193271)');
      await client.query(schemaBootstrap);
      const history = await client.query<{ version: number }>(
        'SELECT version FROM docs_schema_migrations ORDER BY version LIMIT $1',
        [databaseSchemaVersion + 1],
      );
      check(history.rows, true);
      for (const migration of migrations) {
        if (migration.version <= history.rows.length) continue;
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO docs_schema_migrations(version) VALUES($1)',
          [migration.version],
        );
      }
    });
  }
  async grantRuntimeRole(role: string): Promise<void> {
    if (!this.migrate || !/^[a-z_][a-z0-9_]{0,62}$/.test(role))
      throw new Error(
        'A valid runtime role and migration connection are required',
      );
    const name = `"${role}"`;
    await this.query(
      `GRANT USAGE ON SCHEMA public TO ${name}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${name}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${name}; REVOKE UPDATE,DELETE ON docs_audit FROM ${name}; REVOKE INSERT,UPDATE,DELETE ON docs_schema_migrations FROM ${name};`,
    );
  }
  async close() {
    await Promise.all([this.pool.end(), this.relayAuditPool.end()]);
  }
  async healthy() {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
  async projects(): Promise<Project[]> {
    return (
      await this.query<Project>(
        `SELECT ${projectColumns} FROM docs_projects ORDER BY slug`,
      )
    ).rows;
  }
  async project(idOrSlug: string): Promise<Project | undefined> {
    return (
      await this.query<Project>(
        `SELECT ${projectColumns} FROM docs_projects WHERE id::text=$1 OR slug=$1`,
        [idOrSlug],
      )
    ).rows[0];
  }
  async createProject(input: {
    slug: string;
    name: string;
    visibility: 'public' | 'private';
    subject: string;
  }): Promise<Project> {
    try {
      return await this.transaction(async (client) => {
        const id = randomUUID();
        const project = (
          await client.query<Project>(
            `INSERT INTO docs_projects(id,slug,name,visibility) VALUES($1,$2,$3,$4) RETURNING ${projectColumns}`,
            [id, input.slug, input.name, input.visibility],
          )
        ).rows[0]!;
        await client.query(
          'INSERT INTO docs_roles(project_id,subject,role) VALUES($1,$2,$3)',
          [id, input.subject, 'admin'],
        );
        await client.query(
          'INSERT INTO docs_audit(project_id,actor,action) VALUES($1,$2,$3)',
          [id, input.subject, 'project.created'],
        );
        return project;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictError('Project slug already exists');
      throw error;
    }
  }
  async role(projectId: string, subject: string): Promise<Role | undefined> {
    return (
      await this.query<{ role: Role }>(
        'SELECT role FROM docs_roles WHERE project_id=$1 AND subject=$2',
        [projectId, subject],
      )
    ).rows[0]?.role;
  }
  async setRole(
    projectId: string,
    subject: string,
    role: Role | null,
    actor: string,
  ): Promise<void> {
    return this.transaction(async (client) => {
      if (role)
        await client.query(
          'INSERT INTO docs_roles(project_id,subject,role) VALUES($1,$2,$3) ON CONFLICT(project_id,subject) DO UPDATE SET role=excluded.role',
          [projectId, subject, role],
        );
      else
        await client.query(
          'DELETE FROM docs_roles WHERE project_id=$1 AND subject=$2',
          [projectId, subject],
        );
      await client.query(
        'INSERT INTO docs_audit(project_id,actor,action,metadata) VALUES($1,$2,$3,$4)',
        [
          projectId,
          actor,
          role ? 'role.granted' : 'role.revoked',
          JSON.stringify({ subject, role }),
        ],
      );
    });
  }
  async registerArtifact(
    projectId: string,
    artifactId: string,
    subject: string,
  ): Promise<void> {
    return this.transaction(async (client) => {
      await client.query(
        'INSERT INTO docs_artifacts(project_id,artifact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [projectId, artifactId],
      );
      await client.query(
        'INSERT INTO docs_audit(project_id,actor,action,metadata) VALUES($1,$2,$3,$4)',
        [
          projectId,
          subject,
          'artifact.registered',
          JSON.stringify({ artifactId }),
        ],
      );
    });
  }
  async publish(
    projectId: string,
    artifactId: string,
    expected: string | null,
    key: string,
    subject: string,
  ): Promise<Publication> {
    try {
      return await this.transaction(async (client) => {
        const project = (
          await client.query<{ active: string | null }>(
            'SELECT active_publication_id AS active FROM docs_projects WHERE id=$1 FOR UPDATE',
            [projectId],
          )
        ).rows[0];
        if (!project) throw new Error('Project not found');
        const existing = (
          await client.query<Publication>(
            `SELECT ${publicationColumns} FROM docs_publications WHERE project_id=$1 AND idempotency_key=$2`,
            [projectId, key],
          )
        ).rows[0];
        if (existing) {
          if (existing.artifactId !== artifactId)
            throw new ConflictError(
              'Idempotency key was already used for another artifact',
            );
          return existing;
        }
        if (project.active !== expected)
          throw new ConflictError(
            'Publication changed; refresh before publishing',
          );
        const publication = (
          await client.query<Publication>(
            `INSERT INTO docs_publications(id,project_id,artifact_id,subject,idempotency_key) VALUES($1,$2,$3,$4,$5) RETURNING ${publicationColumns}`,
            [randomUUID(), projectId, artifactId, subject, key],
          )
        ).rows[0]!;
        await client.query(
          'UPDATE docs_projects SET active_publication_id=$1 WHERE id=$2',
          [publication.id, projectId],
        );
        await client.query(
          'INSERT INTO docs_audit(project_id,actor,action,metadata) VALUES($1,$2,$3,$4)',
          [
            projectId,
            subject,
            'publication.activated',
            JSON.stringify({
              publicationId: publication.id,
              artifactId,
              previousPublicationId: expected,
            }),
          ],
        );
        return publication;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23503')
        throw new ConflictError(
          'Register a verified artifact before publishing',
        );
      throw error;
    }
  }
  async publication(
    projectId: string,
    publicationId: string,
  ): Promise<Publication | undefined> {
    return (
      await this.query<Publication>(
        `SELECT ${publicationColumns} FROM docs_publications WHERE project_id=$1 AND id=$2`,
        [projectId, publicationId],
      )
    ).rows[0];
  }
  async publications(projectId: string): Promise<Publication[]> {
    return (
      await this.query<Publication>(
        `SELECT ${publicationColumns} FROM docs_publications WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [projectId],
      )
    ).rows;
  }
  async audit(projectId: string): Promise<Record<string, unknown>[]> {
    return (
      await this.query(
        'SELECT id::text,actor,action,metadata,created_at::text FROM docs_audit WHERE project_id=$1 ORDER BY id DESC LIMIT 100',
        [projectId],
      )
    ).rows as Record<string, unknown>[];
  }
  async recordRelay(
    projectId: string,
    subject: string,
    event: RelayAudit,
  ): Promise<void> {
    const {
      requestId,
      phase,
      method,
      origin,
      status,
      outcome,
      requestBytes,
      responseBytes,
      durationMs,
    } = event;
    const query: TimedQueryConfig = {
      query_timeout: 5000,
      text: 'INSERT INTO docs_audit(project_id,actor,action,metadata) VALUES($1,$2,$3,$4)',
      values: [
        projectId,
        subject,
        'relay.' + phase,
        JSON.stringify({
          requestId,
          method,
          origin,
          status,
          outcome,
          requestBytes,
          responseBytes,
          durationMs,
        }),
      ],
    };
    try {
      await this.relayAuditPool.query(query);
    } catch (error) {
      throw databaseError(error);
    }
  }
  async createToken(
    projectId: string,
    hash: string,
    label: string,
    role: Role,
    expiresAt: Date,
    actor: string,
  ): Promise<string> {
    const id = randomUUID();
    return this.transaction(async (client) => {
      await client.query(
        'INSERT INTO docs_tokens(id,project_id,token_hash,label,role,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
        [id, projectId, hash, label, role, expiresAt],
      );
      await client.query(
        'INSERT INTO docs_audit(project_id,actor,action,metadata) VALUES($1,$2,$3,$4)',
        [
          projectId,
          actor,
          'token.created',
          JSON.stringify({ tokenId: id, role, label }),
        ],
      );
      return id;
    });
  }
  async token(
    hash: string,
  ): Promise<{ subject: string; projectId: string; role: Role } | undefined> {
    const token = (
      await this.query<{ id: string; projectId: string; role: Role }>(
        'SELECT id,project_id AS "projectId",role FROM docs_tokens WHERE token_hash=$1 AND revoked=false AND expires_at>now()',
        [hash],
      )
    ).rows[0];
    return token
      ? {
          subject: `token:${token.id}`,
          projectId: token.projectId,
          role: token.role,
        }
      : undefined;
  }
  async revokeToken(
    projectId: string,
    tokenId: string,
    actor: string,
  ): Promise<void> {
    return this.transaction(async (client) => {
      await client.query(
        'UPDATE docs_tokens SET revoked=true WHERE id=$1 AND project_id=$2',
        [tokenId, projectId],
      );
      await client.query(
        'INSERT INTO docs_audit(project_id,actor,action,metadata) VALUES($1,$2,$3,$4)',
        [projectId, actor, 'token.revoked', JSON.stringify({ tokenId })],
      );
    });
  }
  async createSession(
    hash: string,
    subject: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.query('DELETE FROM docs_sessions WHERE expires_at<now()');
    await this.query(
      'INSERT INTO docs_sessions(token_hash,subject,expires_at) VALUES($1,$2,$3)',
      [hash, subject, expiresAt],
    );
  }
  async session(hash: string): Promise<string | undefined> {
    return (
      await this.query<{ subject: string }>(
        'SELECT subject FROM docs_sessions WHERE token_hash=$1 AND expires_at>now()',
        [hash],
      )
    ).rows[0]?.subject;
  }
  async deleteSession(hash: string): Promise<void> {
    await this.query('DELETE FROM docs_sessions WHERE token_hash=$1', [hash]);
  }
  async saveOidc(transaction: OidcTransaction): Promise<void> {
    await this.query('DELETE FROM docs_oidc WHERE expires_at<now()');
    await this.query(
      'INSERT INTO docs_oidc(state_hash,nonce,verifier,expires_at) VALUES($1,$2,$3,$4)',
      [
        transaction.stateHash,
        transaction.nonce,
        transaction.verifier,
        transaction.expiresAt,
      ],
    );
  }
  async consumeOidc(hash: string): Promise<OidcTransaction | undefined> {
    return (
      await this.query<OidcTransaction>(
        'DELETE FROM docs_oidc WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash AS "stateHash",nonce,verifier,expires_at AS "expiresAt"',
        [hash],
      )
    ).rows[0];
  }
}
