# Project Report - College Event Booking & Management System

## 1. Objective
A single full-stack system where students discover and book college events, organizers run them, and admins oversee everything - with server-side authentication
and role-based authorisation, and three complementary database technologies.

## 2. Architecture

```text
                    Next.js frontend (React, TypeScript, Tailwind)
                                    |  fetch (JSON, httpOnly cookie)
                                    v
                  Next.js API layer (route handlers + services)
                    /               |                 \
                   v                v                  v
            PostgreSQL            Neo4j           PostgreSQL + pgvector
        (source of truth)     (graph projection)   (same database, vector column)
        ACID, constraints,    relationships,       semantic similarity,
        triggers, procedures  recommendations      embeddings (384-d)
```

| Layer | Code |
|---|---|
| UI | `src/app/**/page.tsx`, `src/components/*` |
| API (thin) | `src/app/api/**/route.ts` - parse input (Zod), authorise (`requireUser`), call a service |
| Services | `src/lib/events`, `bookings`, `search`, `admin`, `auth`, `neo4j`, `embeddings` |
| Data | `src/lib/db/pool.ts` (parameterised queries, `withTransaction`), `db/schema/*.sql` |

The browser never talks to a database; only the API layer does. PostgreSQL is the only store that decides whether a booking is valid.

## 3. Technology justification

### PostgreSQL - transactional core
Bookings, seats, users and attendance need **ACID transactions**, **foreign keys**, **CHECK / UNIQUE / EXCLUDE constraints**, **row-level locking** and expressive SQL
(joins, window functions, recursive CTEs, triggers, procedures). "Never sell the same last seat twice" is exactly what a relational database with locking is built for.

### Neo4j - relationship-heavy recommendations
"Students who booked what you booked also booked X" and "events in categories connected to your interests, via the category hierarchy" are multi-hop traversals over
student-event-category links. A graph stores those links directly and expresses the traversal in a few readable lines; the equivalent SQL needs repeated self-joins.
Neo4j is a *read-optimised projection* - losing it never loses data.

### pgvector - semantic similarity
Searching *by meaning* needs nearest-neighbour search over embeddings. Keeping the vectors in PostgreSQL next to the events they describe means **one** extra column and index
instead of a separate vector service, the same transaction/backup story, and the ability to combine vector search with ordinary filters (status, date, category) in one SQL statement.

### Why all three (and why not just one)
Each model answers a different question: *is this booking valid?* (relational), *who is connected to what?* (graph), *what is this text similar to?* (vector).
Forcing one engine to do everything would make at least one feature awkward. None of the three is "better" in general; PostgreSQL stays the source of truth, and the other two
are fed from it (or live in it, for pgvector). The cost of this choice is operational complexity (two servers, a sync step), which is why the application degrades gracefully
when Neo4j is unavailable.

## 4. Security
| Topic | Implementation |
|---|---|
| Passwords | bcrypt (cost 10) via `bcryptjs`; seed data hashed with pgcrypto `crypt(..., gen_salt('bf'))` (compatible); never stored or logged in plaintext |
| Sessions | signed JWT (HS256, `jose`) in an `httpOnly`, `SameSite=Lax` cookie, 8 h expiry; `SESSION_SECRET` from environment |
| User state | role and `is_active` re-read from PostgreSQL on each request: role changes and deactivation take effect immediately |
| Authorisation | `requireUser(roles)` at the top of every protected handler (401/403) + ownership checks in services + database triggers |
| Self-registration | always creates a *student*; role in the request body is ignored (tested) |
| Login | same bcrypt cost for unknown e-mails (no account enumeration by timing); generic error message |
| Injection | every query is parameterised (`$1, $2 ...`); dynamic `SET` lists use a whitelist of column names; LIKE wildcards are escaped |
| Input validation | Zod schemas for every body/query (`src/schemas/index.ts`) |
| Errors | database errors mapped to safe HTTP errors; unknown errors become a generic 500 |
| UI gating | `middleware.ts` (cookie present?) and `requirePage()` (valid session + role) - convenience only, the API is the real gate |
| Not implemented | login rate limiting and CSRF tokens (SameSite=Lax mitigates cross-site POSTs); mention as future work |

## 5. Rubric coverage

| Requirement | Implementation | File |
|---|---|---|
| ER diagram | Mermaid ER diagram of the real schema + cardinalities | `docs/ER_DIAGRAM.md` |
| Relational schema, keys, constraints | 9 tables, PK/FK/UNIQUE/CHECK/DEFAULT/EXCLUDE documented | `docs/DATABASE_DESIGN.md`, `db/schema/001_schema.sql` |
| DDL | CREATE/ALTER/INDEX scripts + live DDL demo | `db/schema/001_schema.sql`, `db/demo/01_ddl.sql` |
| DML | INSERT/SELECT/UPDATE/DELETE with rollback | `db/demo/02_dml.sql`, `db/seed/001_seed.sql` |
| JOIN / GROUP BY / HAVING | Q1-Q5 | `db/demo/03_queries.sql` |
| Nested queries | Q6-Q8 (WHERE, FROM, SELECT) | `db/demo/03_queries.sql` |
| Correlated | Q9, Q10 | `db/demo/03_queries.sql` |
| Recursive CTE | Q11, Q12, view `v_category_paths`, cycle check | `db/demo/03_queries.sql`, `db/schema/002_advanced.sql`, `src/lib/admin/service.ts` |
| Function | 7 functions | `db/schema/002_advanced.sql`, `003_vector.sql` |
| Procedure | `cancel_event`, `book_seat`, `complete_finished_events` | `db/schema/002_advanced.sql` |
| Trigger | capacity, timestamps, overbooking, attendance, roles, feedback | `db/schema/002_advanced.sql`, demo `db/demo/04_advanced.sql` |
| CTE / other advanced SQL | CTE + window `RANK()`, view, EXCLUDE constraint, partial/compound/GIN/HNSW indexes, `FOR UPDATE` | `db/demo/03_queries.sql`, `001_schema.sql` |
| Transaction / concurrency | `BEGIN ... FOR UPDATE ... COMMIT`; tested with parallel requests | `src/lib/bookings/service.ts`, `tests/api.test.ts` |
| NoSQL (Neo4j) | schema, sync, queries | `db/nosql/01_schema.cypher`, `src/lib/neo4j/*` |
| NoSQL RUD (+ Create) | READ/CREATE/UPDATE/DELETE script | `db/nosql/02_demo.cypher` |
| Vector DB | pgvector, 384-d, HNSW, cosine search, local embedding model | `db/schema/003_vector.sql`, `src/lib/embeddings/*`, `src/lib/search/service.ts` |
| Technology justification | section 3 above | this file |
| Next.js interface | 9 page routes, role-specific dashboards | `src/app/*`, `src/components/*` |
| Backend/API + DB integration | 30 route handlers, 3 databases wired together | `src/app/api/**`, `docs/API_DOCUMENTATION.md` |
| Authentication | register/login/logout, bcrypt, JWT cookie, 3 roles | `src/lib/auth/*`, `src/app/api/auth/*` |
| RBAC in frontend + backend + DB | UI gating, `requireUser`, ownership checks, DB triggers | `src/lib/auth/guard.ts`, `db/schema/002_advanced.sql` |
| Documentation | 10 documents | `docs/*`, `README.md` |
| Originality | section 6 | this file |

## 6. Original Contributions
Beyond a plain CRUD event-booking app, this project adds:

1. **Concurrency-safe booking in two layers** - an application transaction with `SELECT ... FOR UPDATE` and an independent database trigger that re-checks capacity under the same lock; both verified by parallel-request tests (12 requests / 3 seats -> exactly 3 bookings).
2. **Database-enforced business and role rules** - triggers for capacity vs venue, overbooking, attendance validity, "only students book / only organizers organise", and "feedback only after attending"; an `EXCLUDE` constraint that makes venue double-booking impossible.
3. **Semantic event search with pgvector** - local MiniLM embeddings, HNSW cosine index, keyword/semantic mode switch in the UI, plus "similar events" on each event page.
4. **Graph-based recommendations with explanations** - four Cypher strategies (category affinity, declared interests, collaborative filtering, sibling categories in the category hierarchy) merged and enriched with live seat data; each recommendation states *why* it was suggested; graceful PostgreSQL fallback.
5. **PostgreSQL -> Neo4j projection with self-healing** - incremental sync after each transaction, circuit breaker when Neo4j is down, full rebuild command.
6. **Hierarchical categories** - self-referencing table, recursive view, recursive roll-up queries, cycle detection, graph `SUBCATEGORY_OF` edges.
7. **Attendance analytics and popularity analysis** - per-event fill %, attendance %, bookings per day, rating distribution; admin ranking with window functions.
8. **Feedback tied to attendance** - ratings can only come from students marked present; feed the average rating shown on cards.
9. **Role-specific workspaces** - student dashboard (recommendations, interests), organizer event manager with participants/attendance/statistics, admin console (users, venues, categories, all bookings, system statistics).
10. **Atomic event cancellation** through a stored procedure that authorises the caller and cancels all bookings in one step.
11. **Safe live-demo tooling** - every demo script rolls back or cleans up; `npm run setup` rebuilds all three stores; graceful degradation when Neo4j or the embedding model is unavailable.

## 7. Limitations and future work
* Neo4j sync is best-effort/eventual (repair with `npm run neo4j:setup`).
* No e-mail notifications, waiting lists or payment.
* No login rate limiting / CSRF tokens / password reset.
* Event times use the browser's time zone for entry and are stored as `timestamptz`.
* Semantic quality depends on the embedding model; the offline `hash` provider is only a lexical fallback.
