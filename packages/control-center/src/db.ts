import { Pool, type PoolClient, type QueryResult } from "pg";
import { MIGRATIONS } from "./migrations.js";

export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<QueryResult<Record<string, unknown>>>;
}

export type { Pool, PoolClient, QueryResult };

export interface ControlCenterDatabase {
  pool: Pool;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string, log: (message: string) => void): ControlCenterDatabase {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });

  async function migrate() {
    await pool.query(`create table if not exists cc_schema_migrations (id text primary key, applied_at timestamptz not null default now())`);
    const existing = await pool.query<{ id: string }>("select id from cc_schema_migrations");
    const applied = new Set(existing.rows.map((row) => row.id));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      log(`applying migration ${migration.id}`);
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(migration.sql);
        await client.query("insert into cc_schema_migrations (id) values ($1) on conflict (id) do nothing", [migration.id]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async function close() {
    await pool.end();
  }

  return { pool, migrate, close };
}
