import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

// One shared pool per Node process (survives Next.js hot reloads in dev).
const globalForPg = globalThis as unknown as { __cebPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__cebPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
    globalForPg.__cebPool = new Pool({ connectionString, max: 20 });
  }
  return globalForPg.__cebPool;
}

/** Parameterised query. Always pass user input through `params`, never string-concatenate it. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Runs `fn` inside BEGIN ... COMMIT (ROLLBACK on any error) on a dedicated connection. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (globalForPg.__cebPool) {
    await globalForPg.__cebPool.end();
    globalForPg.__cebPool = undefined;
  }
}
