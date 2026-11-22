import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
let pool;
export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
    const connection = new URL(process.env.DATABASE_URL);
    // Keep certificate/hostname verification explicit when pg changes its
    // interpretation of the legacy SSL mode aliases in a future major release.
    if (!connection.searchParams.has('uselibpqcompat') && ['prefer', 'require', 'verify-ca'].includes(connection.searchParams.get('sslmode'))) connection.searchParams.set('sslmode', 'verify-full');
    pool = new pg.Pool({ connectionString: connection.toString(), max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
export async function readState() {
  const { rows } = await getPool().query('SELECT payload, revision FROM catalog_state WHERE id = 1');
  if (!rows[0]) throw Object.assign(new Error('Каталог ещё не импортирован. Запустите db:seed.'), { status: 503 });
  return { ...rows[0].payload, revision: rows[0].revision };
}
export async function saveState(payload, revision) {
  const { rows } = await getPool().query('UPDATE catalog_state SET payload=$1, revision=revision+1, updated_at=now() WHERE id=1 AND revision=$2 RETURNING revision', [payload, revision]);
  if (!rows[0]) throw Object.assign(new Error('Каталог изменён в другом окне. Скачайте резервную копию своих правок и перезагрузите страницу.'), { status: 409 });
  return { ...payload, revision: rows[0].revision };
}
