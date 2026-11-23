import { query } from '@/lib/db/pool';
import { embedText, eventEmbeddingText, toVectorLiteral } from './index';

/** Re-computes and stores the embedding of one event. Safe to call after every create/update. */
export async function refreshEventEmbedding(eventId: number): Promise<void> {
  const { rows } = await query<{ title: string; description: string; category_name: string }>(
    `SELECT e.title, e.description, c.name AS category_name
     FROM events e JOIN categories c ON c.category_id = e.category_id WHERE e.event_id = $1`,
    [eventId],
  );
  if (!rows[0]) return;
  const vec = await embedText(
    eventEmbeddingText({ title: rows[0].title, description: rows[0].description, categoryName: rows[0].category_name }),
  );
  await query('UPDATE events SET embedding = $1::vector WHERE event_id = $2', [toVectorLiteral(vec), eventId]);
}

/** Best-effort wrapper: a failing embedding model must never make event creation fail. */
export async function safeRefreshEmbedding(eventId: number): Promise<void> {
  try {
    await refreshEventEmbedding(eventId);
  } catch (err) {
    console.error(`[embeddings] could not embed event ${eventId}:`, (err as Error).message);
  }
}

export async function embedAllEvents(onProgress?: (done: number, total: number) => void): Promise<number> {
  const { rows } = await query<{ event_id: number }>('SELECT event_id FROM events ORDER BY event_id');
  let done = 0;
  for (const r of rows) {
    await refreshEventEmbedding(r.event_id);
    onProgress?.(++done, rows.length);
  }
  return rows.length;
}
