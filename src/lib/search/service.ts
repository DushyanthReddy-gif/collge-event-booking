import { query } from '@/lib/db/pool';
import { embedText, embeddingProvider, toVectorLiteral } from '@/lib/embeddings';
import { EVENT_COLUMNS, listEvents, whenClause, type EventSummary } from '@/lib/events/service';

export interface SearchParams {
  q: string;
  mode: 'keyword' | 'semantic';
  categoryId?: number;
  when: 'upcoming' | 'past' | 'all';
  limit: number;
}

export interface SearchResult {
  mode: 'keyword' | 'semantic';
  query: string;
  embeddingProvider?: string;
  results: EventSummary[];
}

/**
 * Keyword mode  : PostgreSQL full-text search (GIN index) + ILIKE, ranked by ts_rank.
 * Semantic mode : the query text is embedded locally into a 384-d vector and the nearest events are
 *                 found with pgvector's cosine-distance operator (<=>), using the HNSW index.
 */
export async function searchEvents(p: SearchParams): Promise<SearchResult> {
  if (p.mode === 'semantic' && p.q) {
    const vec = toVectorLiteral(await embedText(p.q));
    const params: unknown[] = [vec];
    const where = [whenClause(p.when), 'e.embedding IS NOT NULL'];
    if (p.categoryId) {
      params.push(p.categoryId);
      where.push(`o.category_id = $${params.length}`);
    }
    params.push(p.limit);
    const { rows } = await query<EventSummary>(
      `SELECT ${EVENT_COLUMNS}, (1 - (e.embedding <=> $1::vector))::float AS similarity
       FROM v_event_overview o
       JOIN events e ON e.event_id = o.event_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.embedding <=> $1::vector
       LIMIT $${params.length}`,
      params,
    );
    return { mode: 'semantic', query: p.q, embeddingProvider: embeddingProvider(), results: rows };
  }

  const results = await listEvents(null, {
    q: p.q || undefined,
    categoryId: p.categoryId,
    when: p.when,
    scope: 'public',
    limit: p.limit,
    offset: 0,
  });
  return { mode: 'keyword', query: p.q, results };
}

/** "More like this" - nearest neighbours of an event's own embedding (SQL function similar_events). */
export async function similarEvents(eventId: number, limit = 4): Promise<EventSummary[]> {
  const { rows } = await query<EventSummary>(
    `SELECT ${EVENT_COLUMNS}, s.similarity::float AS similarity
     FROM similar_events($1, $2) s JOIN v_event_overview o ON o.event_id = s.event_id
     WHERE o.end_time > now()
     ORDER BY s.similarity DESC`,
    [eventId, limit + 4],
  );
  return rows.slice(0, limit);
}
