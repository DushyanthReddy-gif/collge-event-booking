import { route } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { popularFallback, recommendForStudent } from '@/lib/neo4j/recommendations';

// Graph-based recommendations (Neo4j). If Neo4j is down we degrade to a PostgreSQL popularity list.
export const GET = route(async () => {
  const user = await requireUser(['student']);
  try {
    const { items, usedGraph } = await recommendForStudent(user.userId, 6);
    return { source: 'neo4j', graphSignals: usedGraph, recommendations: items };
  } catch (err) {
    console.error('[recommendations] Neo4j unavailable:', (err as Error).message);
    return { source: 'postgres-fallback', graphSignals: false, recommendations: await popularFallback(user.userId, 6) };
  }
});
