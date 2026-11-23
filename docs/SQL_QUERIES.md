# SQL Demonstration Scripts

All scripts run against the seeded database. Run them with (Docker):

```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -f /db/demo/<file>.sql
```

| Script | Demonstrates | Safe to repeat? |
|---|---|---|
| `db/demo/01_ddl.sql` | CREATE TABLE (PK, FK, UNIQUE, NOT NULL, CHECK, DEFAULT), ALTER TABLE (add column, add constraint, rename, change type), CREATE INDEX, constraint violations, catalog queries, DROP | yes - uses a throw-away table `demo_event_tags` |
| `db/demo/02_dml.sql` | INSERT, SELECT, UPDATE, DELETE, RETURNING, FK `RESTRICT` | yes - whole script ends in `ROLLBACK` |
| `db/demo/03_queries.sql` | JOINs, GROUP BY, HAVING, aggregates, nested, correlated, recursive, window | yes - read only |
| `db/demo/04_advanced.sql` | functions, view, 4+ triggers, procedures, transaction with `FOR UPDATE`, EXPLAIN | yes - changes are rolled back, violations are caught |
| `db/demo/05_vector.sql` | pgvector inspection and similarity queries | yes - read only |
| `db/demo/99_drop_demo.sql` | safety-net cleanup | yes |

## Rubric map for `03_queries.sql`

| Query | Concept | What it answers |
|---|---|---|
| Q1 | INNER JOIN (2 tables) | events with venue and capacities |
| Q2 | multi-table JOIN (5 tables) | one student's bookings with event, category and venue |
| Q3 | LEFT JOIN | every event with its booking count, zero included |
| Q4 | GROUP BY + COUNT/SUM/AVG | fill rate and rating per category |
| Q5 | GROUP BY + HAVING | students with at least 3 confirmed bookings |
| Q6 | nested query - subquery in `WHERE` (`IN`) | students who hold a seat in a sold-out event |
| Q7 | nested query - subquery in `FROM` (derived table) + scalar subquery in `WHERE` | events booked more than the average event |
| Q8 | nested query - scalar subqueries in `SELECT` | booked / cancelled / rating per event inline |
| Q9 | **correlated** subquery | events booked more than the average of their *own* root category |
| Q10 | **correlated** `EXISTS` / `NOT EXISTS` | students who attended something but never left feedback |
| Q11 | **recursive CTE** | category tree with depth and path (`Technical > Artificial Intelligence > Machine Learning`) |
| Q12 | **recursive CTE** roll-up | events per root category *including all sub-categories at any depth* |
| Q13 | CTE + window function `RANK() OVER (PARTITION BY ...)` | most popular event inside each root category |
| Q14 | view + functions | attendance rate and rating for completed events |

The recursive CTE is used meaningfully in production code too: `v_category_paths` (view), the category cycle check in
`src/lib/admin/service.ts` (`assertNoCycle`) and the Neo4j equivalent `SUBCATEGORY_OF*`.

## Rubric map for `04_advanced.sql`

| Step | Concept |
|---|---|
| A1 | functions `confirmed_booking_count`, `seats_remaining`, `average_event_rating`, `attendance_rate` |
| A2 | view `v_event_overview` |
| A3 | trigger 1 - capacity vs venue capacity |
| A4 | trigger 2 - automatic `cancelled_at` |
| A5 | trigger 3 - overbooking blocked |
| A6 | trigger 4 - attendance on a non-confirmed booking blocked |
| A7, A8 | role triggers and feedback-requires-attendance |
| A9 | EXCLUDE constraint (venue clash) |
| A10 | stored procedure `cancel_event` (atomic, authorised, returns a count) |
| A11 | explicit transaction with row-level locking |
| A12 | stored procedure `book_seat` |
| A13 | `EXPLAIN` showing index usage |

## Note on psql meta-commands
`\echo` and `\gset` in the demo files are psql features, so run the demos with `psql -f` (not through a GUI that does not understand them).
