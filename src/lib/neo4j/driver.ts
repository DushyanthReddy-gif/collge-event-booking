import neo4j, { type Driver } from 'neo4j-driver';

const g = globalThis as unknown as { __cebNeo4j?: Driver };

export function getDriver(): Driver {
  if (!g.__cebNeo4j) {
    const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER ?? 'neo4j';
    const password = process.env.NEO4J_PASSWORD ?? '';
    g.__cebNeo4j = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      disableLosslessIntegers: true, // read Neo4j integers back as plain JS numbers
      connectionTimeout: 4000,
      maxTransactionRetryTime: 5000,
    });
  }
  return g.__cebNeo4j;
}

/** JS numbers are sent as FLOAT by the driver; convert whole numbers to Neo4j INTEGER recursively. */
export function toNeo(value: unknown): unknown {
  if (typeof value === 'number' && Number.isInteger(value)) return neo4j.int(value);
  if (Array.isArray(value)) return value.map(toNeo);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toNeo(v)]));
  }
  return value;
}

// Circuit breaker: when Neo4j is unreachable, skip it for 30 s instead of waiting for a timeout
// on every booking. PostgreSQL remains fully functional in the meantime.
let downUntil = 0;
export const neo4jBackedOff = () => Date.now() < downUntil;
function noteFailure(err: unknown) {
  const code = (err as { code?: string })?.code ?? '';
  if (code === 'ServiceUnavailable' || code === 'SessionExpired' || code.includes('Security')) downUntil = Date.now() + 30_000;
}
function guardBreaker() {
  if (neo4jBackedOff()) throw new Error('Neo4j is unavailable (retrying shortly)');
}

export async function runRead<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
  guardBreaker();
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const res = await session.run(cypher, toNeo(params) as Record<string, unknown>);
    return res.records.map((r) => r.toObject() as T);
  } catch (err) {
    noteFailure(err);
    throw err;
  } finally {
    await session.close();
  }
}

export async function runWrite(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
  guardBreaker();
  const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.run(cypher, toNeo(params) as Record<string, unknown>);
  } catch (err) {
    noteFailure(err);
    throw err;
  } finally {
    await session.close();
  }
}

export async function neo4jIsUp(): Promise<boolean> {
  try {
    await getDriver().getServerInfo();
    downUntil = 0;
    return true;
  } catch (err) {
    noteFailure(err);
    return false;
  }
}

export async function closeDriver(): Promise<void> {
  if (g.__cebNeo4j) {
    await g.__cebNeo4j.close();
    g.__cebNeo4j = undefined;
  }
}
