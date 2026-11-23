# Testing

Two Vitest suites (`tests/`), **38 tests**, run against a real PostgreSQL and a running instance of the app.

```bash
docker compose up -d
npm run setup                      # fresh seed data (+ embeddings, + graph)
npm run dev                        # terminal 1 (or: npm run build && npm start)
npm test                           # terminal 2
```
Tests read `.env` (`DATABASE_URL`, `TEST_BASE_URL`, default `http://localhost:3000`). They clean up after themselves (events titled `TEST ...`, users `@test.edu`).
Neo4j does not have to be running: the recommendation test accepts the documented PostgreSQL fallback. For fully offline runs set `EMBEDDING_PROVIDER=hash` in the server's environment **and** run `npm run db:embed` with the same setting.

## `tests/api.test.ts` - black-box HTTP tests (27)

| Area | Test |
|---|---|
| Registration | creates a student, stores a bcrypt hash, ignores `role: "admin"` in the body; duplicate e-mail 409; weak password 400 |
| Login | success + redirect target; wrong password 401; unknown e-mail 401; logout invalidates; forged cookie 401 |
| Unauthorised access | anonymous callers get 401 on protected routes |
| Role restrictions | student blocked (403) from create-event, participants, attendance, manage scope, admin routes; organizer blocked from booking/admin/recommendations; admin allowed |
| Visibility | draft events 404 for the public, visible to owner |
| Organizer access | owner edits own event; another organizer gets 403 on edit/participants/cancel; admin can edit any; capacity > venue rejected; bad dates rejected |
| Booking | success; duplicate prevented; cancel; cancel twice 404; re-book; full event rejected; draft / past / unknown event rejected |
| **Concurrency** | **12 parallel booking requests for 3 seats -> exactly 3 x 201 and 9 x 409, database count = 3** |
| **Concurrency (DB only)** | **10 parallel raw `INSERT`s bypassing the API -> exactly 3 succeed, 7 fail with `UE002`** |
| Event cancellation | procedure cancels the event and all bookings; students cannot re-book; cancelling twice -> 409 |
| Attendance | organizer marks; student and other organizer get 403; cancelled booking rejected by trigger (409); statistics correct |
| Feedback | rejected before attendance (403); rating 6 -> 400; success; duplicate 409; average rating updates |
| Admin | create/delete venue; delete venue in use -> 409; admin cannot deactivate self; deactivated user is locked out at once; category cycle rejected by the recursive check |
| Recommendations | students only; returns `neo4j` or `postgres-fallback`; never recommends an already-booked event |
| Search | keyword (full-text) finds the cricket tournament; semantic results are sorted by similarity and contain *Robotics Workshop*; paraphrase finds the robotics event; "similar events" excludes itself |

## `tests/database.test.ts` - SQL-level tests (11)
Each mutating test runs in a transaction that is always rolled back.
Functions; trigger 1 (capacity vs venue); trigger 2 (timestamps); trigger 3 (overbooking); trigger 4 (attendance) incl. unauthorised marker; role triggers; feedback-requires-attendance;
constraints (duplicate booking `23505`, rating `23514`, FK `23503`, venue overlap `23P01`); procedure `cancel_event` (authorisation, count, atomicity); recursive view; pgvector (extension, 384 dimensions, HNSW definition, similarity ordering).

## SQL / Cypher demo scripts as tests
`db/demo/*.sql` were executed with `psql -v ON_ERROR_STOP=1` and complete without error. `db/nosql/*.cypher` could **not** be executed in the build environment (no Neo4j server was available); the Cypher uses standard Neo4j 5 syntax - run `npm run neo4j:setup` and the demo script on your machine to confirm.

## Static checks
`npm run typecheck` (TypeScript strict) and `npm run build` (includes route type validation) pass.
