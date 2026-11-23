# Vector database: PostgreSQL + pgvector

## What it does
Semantic event search: the query *"robotics and AI workshop"* finds events about robots, sensors, machine learning, neural networks ... even when those exact words are absent
from the title. The same machinery powers the **"Similar events"** list on every event page.

## Technical summary

| Item | Value | Where |
|---|---|---|
| Extension | `vector` (pgvector) | `db/schema/003_vector.sql` |
| Column | `events.embedding vector(384)` | added with `ALTER TABLE` |
| Embedding model | `Xenova/all-MiniLM-L6-v2` (sentence-transformers MiniLM, runs locally in Node through ONNX, **no API key**) | `src/lib/embeddings/index.ts` |
| Dimension | **384** | |
| Text embedded | `title. category name. description` | `eventEmbeddingText()` |
| Normalisation | mean pooling + L2-normalised vectors | |
| Distance | cosine distance `<=>`; **similarity = 1 - distance** | |
| Index | `HNSW (embedding vector_cosine_ops)` | `idx_events_embedding_hnsw` |
| Generation | `npm run db:embed` (all events), and automatically on every event create/update | `src/lib/embeddings/events.ts` |

## Pipeline
1. **Store**: `refreshEventEmbedding(eventId)` embeds the event text and runs
   `UPDATE events SET embedding = $1::vector WHERE event_id = $2` (vector literal `'[0.01,-0.04,...]'`).
2. **Query**: `GET /api/search?mode=semantic&q=...` embeds the query text with the *same* model, then runs

```sql
SELECT ..., (1 - (e.embedding <=> $1::vector)) AS similarity
FROM v_event_overview o JOIN events e ON e.event_id = o.event_id
WHERE o.status = 'published' AND o.end_time > now() AND e.embedding IS NOT NULL
ORDER BY e.embedding <=> $1::vector
LIMIT 12;
```

3. **Rank**: results come back best-first with a similarity score; the UI shows "87% match" on each card.
4. **Keyword mode** (`mode=keyword`) uses PostgreSQL full-text search (`websearch_to_tsquery`, GIN index) plus `ILIKE`, ranked by `ts_rank`.
5. **More like this**: SQL function `similar_events(event_id, limit)` compares an event's embedding with all others.

## Why HNSW
Exact search compares the query with every row (fine for 17 events, slow for 1 million). HNSW is an approximate nearest-neighbour graph index: it trades a tiny amount of
recall for logarithmic-like lookup time. The planner will use it for the `ORDER BY embedding <=> $1 LIMIT n` pattern once the table is large; on the tiny demo table a sequential scan is cheaper,
which is normal PostgreSQL behaviour. Use `db/demo/05_vector.sql` to inspect the index definition.

## Embedding providers (`EMBEDDING_PROVIDER` in `.env`)

| Value | Behaviour |
|---|---|
| `transformers` (default) | real semantic model. The first run downloads ~25 MB from Hugging Face into `./.cache/models`; afterwards it works offline |
| `hash` | offline fallback used by the automated tests: hashed word features plus a tiny concept lexicon (robot/automation/drone -> *robotics*, ai/ml/neural -> *ai* ...). It lets the full pipeline (storage, `<=>`, ranking, index) run without a download, but it is **lexical-ish, not truly semantic** |

Both providers produce 384-d unit vectors. Stored vectors and query vectors must come from the same provider; after switching run `npm run db:embed`.

> Verification status: the whole pipeline was executed and tested with the `hash` provider. The `transformers` provider could not be downloaded in the build sandbox
> (no access to huggingface.co); its code path loads correctly and fails only at the network step. Run `npm run db:embed` once with internet access to confirm on your machine.

## Demo queries
```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -f /db/demo/05_vector.sql
```
and in the browser: **Events -> type "robotics and AI workshop" -> Semantic**.
