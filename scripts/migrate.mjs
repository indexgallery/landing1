import { getPool } from '../server/db.mjs';
export async function migrate() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS catalog_state (
      id integer PRIMARY KEY CHECK (id=1), payload jsonb NOT NULL,
      revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS media (
      object_key text PRIMARY KEY, url text NOT NULL UNIQUE, content_type text NOT NULL,
      size_bytes bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      key text PRIMARY KEY, attempts integer NOT NULL, started_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
if (process.argv[1]?.endsWith('/migrate.mjs')) {
  try { await migrate(); console.log('Database schema ready.'); } finally { await getPool().end(); }
}
