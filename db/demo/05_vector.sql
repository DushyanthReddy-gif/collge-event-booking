-- =============================================================================
-- DEMO 05 - pgvector: inspect embeddings and run similarity searches in SQL
-- Requires `npm run db:embed` to have filled events.embedding.
-- Run: psql -f db/demo/05_vector.sql
-- =============================================================================
\echo '=== V1  Extension, column type and index'
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
SELECT column_name, udt_name FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'embedding';
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_events_embedding_hnsw';

\echo '=== V2  How many events have an embedding, and its dimension'
SELECT COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_events, MAX(vector_dims(embedding)) AS dimensions FROM events;

\echo '=== V3  "More like this": events nearest to the Robotics Workshop (cosine similarity)'
SELECT * FROM similar_events((SELECT event_id FROM events WHERE title = 'Robotics Workshop'), 5);

\echo '=== V4  Raw cosine-distance query with the <=> operator, using another event as the query vector'
SELECT e.title, ROUND((1 - (e.embedding <=> q.embedding))::numeric, 3) AS similarity
FROM events e, (SELECT embedding FROM events WHERE title = 'AI Seminar: The Future of Generative AI') q
WHERE e.embedding IS NOT NULL AND e.status = 'published'
ORDER BY e.embedding <=> q.embedding LIMIT 5;
-- For free-text queries the application embeds the text first (see docs/VECTOR_SEARCH.md):
--   SELECT * FROM semantic_search_events('[0.01, -0.03, ... 384 numbers ...]'::vector, 5);
