# Demo Guide (viva / presentation script)

Total time about 25-30 minutes. Steps 1-3 are done *before* the audience arrives. All demo accounts use the password **`Password@123`**.

| Role | Email |
|---|---|
| Admin | `admin@college.edu` |
| Organizer | `rajesh.kumar@college.edu` (Computer Science), `priya.menon@college.edu` (Student Activities) |
| Student | `aarav.sharma@college.edu` (and 9 more: `diya.patel@`, `rohan.mehta@`, `ananya.iyer@` ... `@college.edu`) |

Shortcut for psql: `alias pg='docker compose exec -T postgres psql -U ceb_user -d college_events'` (Linux/macOS). On Windows type the full command.

---
## Part A - Start everything

**1. Start Docker databases**
```bash
docker compose up -d
docker compose ps          # wait until both show "healthy" (Neo4j takes ~30-60 s the first time)
```

**2. Prepare data (first time, or whenever you want a clean reset)**
```bash
cp .env.example .env       # first time only
npm install                # first time only
npm run setup              # = db:reset + db:embed + neo4j:setup
```
This (a) drops/creates the PostgreSQL schema and loads seed data, (b) computes a 384-d pgvector embedding for every event, (c) creates the Neo4j constraints and copies the data into the graph.
Expected last lines: `PostgreSQL ready: 13 users, 17 events, 70 bookings.` ... `Stored 17 embeddings` ... `Neo4j graph rebuilt from PostgreSQL: ... nodes, ... relationships.`

**3. Start Next.js**
```bash
npm run dev                # http://localhost:3000
```

---
## Part B - The application

**4. Login as Student** - open <http://localhost:3000/login>, `aarav.sharma@college.edu`. You land on `/dashboard`.
*Say:* the password is stored as a bcrypt hash; the session is an httpOnly cookie; the server re-reads the user's role from PostgreSQL on every request.

**5. Browse events** - `/events`. Use the category filter (hierarchy shown as `Technical › Artificial Intelligence`), filter *Upcoming / Past*.
Keyword search: type `cricket` -> *Keyword* -> Search (PostgreSQL full-text search, GIN index).

**6. Book an event** - open *Photography Workshop* -> **Book a seat**. The seat counter drops from 22 to 21. Click again: it is replaced by *Cancel my booking*.
Try *Machine Learning Bootcamp*: it shows **Sold out** (5 of 5 seats).

**7. Show the booking in PostgreSQL**
```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -c "SELECT booking_id, student_name, event_title, booking_status, booked_at FROM v_booking_details WHERE student_email='aarav.sharma@college.edu' ORDER BY booked_at DESC;"
```
Also `/my-bookings` in the UI (cancel works there too).

**8-10. Login as Organizer** - log out, log in as `rajesh.kumar@college.edu` -> `/organizer`.
* **New event**: title `Embedded Systems Lab`, description `Hands-on microcontroller programming with sensors`, category *Robotics*, venue *Computer Lab 3*, capacity `20`, pick a future date, status *Publish now*. (Try capacity `61`: the database trigger refuses it - Computer Lab 3 holds 60.)
* **Edit**/**Publish**/**Cancel** buttons manage the lifecycle. Cancel calls the stored procedure `cancel_event` and cancels all bookings atomically.
* Open **Participants** on *Robotics Workshop*: statistics (fill %, attendance %, bookings per day) and the attendance table. Tick *Present* for two students -> **Save attendance**.

**11. Show Neo4j relationships** - open <http://localhost:7474> (user `neo4j`, password `ceb_neo4j_password`) and run
```cypher
MATCH p=(s:Student {name:'Aarav Sharma'})-[:BOOKED|ATTENDED|LIKES]->() RETURN p
```
Then run the Cypher CRUD demo script (see step 20 below). The booking from step 6 and the attendance from step 10 already appear as `BOOKED` / `ATTENDED` edges (synced after each transaction).

**12. Graph-based recommendations** - log in as Aarav again -> `/dashboard` -> *Recommended for you* (each card says why, e.g. *You booked or attended 2 "Competitive Coding" event(s)*, *3 student(s) with similar bookings also booked this*).
Under *Your interests* tick *Cybersecurity* -> **Save interests**: a new `LIKES` edge is created and the recommendations change.

**13. Semantic search** - `/events` -> type `robotics and AI workshop` -> choose **Semantic** -> Search. Results are ranked with a *% match*. Then try `learn to build machines with sensors` and `startup funding for founders` - the matching events appear although the words differ.
Open any event: the *Similar events* strip is a pgvector nearest-neighbour query.

**Prove RBAC without the UI** (backend enforcement)
```bash
# log in as a student and keep the cookie
curl -s -c /tmp/stu.txt -H "Content-Type: application/json" -d '{"email":"aarav.sharma@college.edu","password":"Password@123"}' http://localhost:3000/api/auth/login
# a student calls organizer / admin endpoints directly -> 403
curl -s -b /tmp/stu.txt -X POST -H "Content-Type: application/json" -d '{}' http://localhost:3000/api/events
curl -s -b /tmp/stu.txt http://localhost:3000/api/admin/stats
# no cookie at all -> 401
curl -s -X POST http://localhost:3000/api/events/1/book
```
Expected: `{"error":"This action requires one of the roles: organizer, admin"}`, `{"error":"This action requires one of the roles: admin"}`, `{"error":"Please log in"}`.
Log in as `admin@college.edu` -> `/admin` for system statistics, users (change roles / deactivate), events, venues, categories and *all* bookings.

---
## Part C - SQL demonstrations
Run each file from the project folder. Replace the shortcut if needed.

**14. DDL**
```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -f /db/demo/01_ddl.sql
```
Shows CREATE TABLE with PK/FK/UNIQUE/NOT NULL/CHECK/DEFAULT, ALTER TABLE, CREATE INDEX, four rejected inserts (NOTICE lines), the real `events` constraints and indexes, then DROP.

**15. DML**
```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -f /db/demo/02_dml.sql
```
INSERT / SELECT / UPDATE / DELETE inside a transaction that ends with ROLLBACK (the last query proves the event count is unchanged).

**16-19. JOIN, nested, correlated, recursive**
```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -f /db/demo/03_queries.sql
```
Scroll to: Q2 (5-table JOIN), Q3 (LEFT JOIN), Q5 (HAVING), Q6-Q8 (nested), Q9-Q10 (correlated), Q11-Q12 (**recursive CTE**: category tree and roll-up). Explain each with [SQL_QUERIES.md](SQL_QUERIES.md).

**20-22. Function, procedure, trigger**
```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -f /db/demo/04_advanced.sql
```
A1 functions, A3-A9 triggers (every `NOTICE: BLOCKED by ...` line is a rule firing), A10 procedure `cancel_event` (returns the number of cancelled bookings, then ROLLBACK), A11-A12 transaction with `FOR UPDATE`, A13 `EXPLAIN`.

**Neo4j CRUD / RUD** (rubric: NoSQL RUD)
```bash
docker compose exec -T neo4j cypher-shell -u neo4j -p ceb_neo4j_password -f /db/nosql/02_demo.cypher
```
READ (R1-R7 incl. recommendation query), CREATE (C1-C2), UPDATE (U1-U3), DELETE (D1-D3, last row `remaining_demo_nodes = 0`).

**pgvector in SQL**
```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -f /db/demo/05_vector.sql
```

**23. Transaction / concurrency**
*Automated:* `npm test` runs `CONCURRENCY: 12 simultaneous bookings for 3 seats -> exactly 3 succeed` (via the API) and the same race with raw SQL inserts (via the trigger alone). Run just that: `npx vitest run -t CONCURRENCY`.

*Manual with two terminals* (shows the row lock). First leave exactly one free seat on *Photography Workshop* (3 booked, capacity 25 -> set 4):
```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -c "UPDATE events SET capacity = 4 WHERE title='Photography Workshop'"
```
Terminal 1:
```bash
docker compose exec postgres psql -U ceb_user -d college_events
BEGIN;
SELECT event_id FROM events WHERE title='Photography Workshop' FOR UPDATE;     -- lock held
INSERT INTO bookings (event_id, student_id) SELECT e.event_id, u.user_id FROM events e, users u WHERE e.title='Photography Workshop' AND u.email='ananya.iyer@college.edu';
-- do NOT commit yet
```
Terminal 2 (it will **hang**, waiting for the lock):
```bash
docker compose exec postgres psql -U ceb_user -d college_events
INSERT INTO bookings (event_id, student_id) SELECT e.event_id, u.user_id FROM events e, users u WHERE e.title='Photography Workshop' AND u.email='kabir.singh@college.edu';
```
Back in Terminal 1: `COMMIT;` -> Terminal 2 immediately fails with `ERROR: Event ... is fully booked (4 of 4 seats)`. Restore afterwards:
```bash
docker compose exec -T postgres psql -U ceb_user -d college_events -c "DELETE FROM bookings WHERE student_id=(SELECT user_id FROM users WHERE email='ananya.iyer@college.edu') AND event_id=(SELECT event_id FROM events WHERE title='Photography Workshop'); UPDATE events SET capacity = 25 WHERE title='Photography Workshop'"
```
(or simply `npm run setup` to reset everything).

---
## Part D - Documentation and justification

**24. Show the ER diagram** - open `docs/ER_DIAGRAM.md` in VS Code / GitHub (Mermaid). Walk through: roles -> users -> events/bookings, self-referencing categories, venues, attendance (1:0..1 with bookings), feedback, student_interests (many-to-many).

**25. Explain technology choices** (see [PROJECT_REPORT.md](PROJECT_REPORT.md) section 3)
* PostgreSQL: bookings need ACID, constraints, row locking, complex SQL.
* Neo4j: recommendations are multi-hop relationship queries.
* pgvector: semantic similarity over embeddings, next to the data it describes (no extra system).
* Not "one is better": each is used where its model fits, and PostgreSQL stays the single source of truth.

---
## If something goes wrong
| Symptom | Fix |
|---|---|
| Recommendations say *Neo4j is offline* | Neo4j still starting: `docker compose ps`, then `npm run neo4j:setup`. The app keeps working on PostgreSQL meanwhile |
| Semantic search returns nothing | embeddings missing: `npm run db:embed` |
| `db:embed` fails to download the model | no internet: set `EMBEDDING_PROVIDER=hash` in `.env`, restart `npm run dev`, run `npm run db:embed` (lexical fallback, see VECTOR_SEARCH.md) |
| Messy data after rehearsal | `npm run setup` resets everything |
| Port 5432 busy | stop the local PostgreSQL or change the port mapping in `docker-compose.yml` **and** `DATABASE_URL` |
