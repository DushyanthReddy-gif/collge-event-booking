# Database Design

PostgreSQL 16 is the system of record. Everything below exists in the scripts under `db/schema/` and was executed and tested
(`tests/database.test.ts`, `db/demo/*.sql`).

| File | Content |
|---|---|
| `db/schema/001_schema.sql` | tables, constraints, `ALTER TABLE`, indexes |
| `db/schema/002_advanced.sql` | functions, triggers, stored procedures, views |
| `db/schema/003_vector.sql` | pgvector column, HNSW index, similarity functions |
| `db/seed/001_seed.sql` | demo data (13 users, 17 events, 70 bookings, attendance, feedback) |

## 1. Relational schema

Underlined = primary key, `FK` = foreign key. See [ER_DIAGRAM.md](ER_DIAGRAM.md) for the picture.

```text
roles(role_id PK, role_name UNIQUE CHECK IN (student,organizer,admin), description)
users(user_id PK, full_name, email UNIQUE, password_hash, role_id FK->roles, department, is_active, created_at, updated_at)
categories(category_id PK, name UNIQUE, description, parent_category_id FK->categories)
venues(venue_id PK, name UNIQUE, location, capacity CHECK>0, is_active)
events(event_id PK, title, description, category_id FK, venue_id FK, organizer_id FK->users,
       start_time, end_time, capacity CHECK>0, status CHECK, cancelled_at, created_at, updated_at, embedding vector(384))
bookings(booking_id PK, event_id FK, student_id FK->users, status CHECK, booked_at, cancelled_at)
attendance(attendance_id PK, booking_id FK UNIQUE, attended, marked_at, marked_by FK->users)
feedback(feedback_id PK, event_id FK, student_id FK->users, rating CHECK 1..5, comment, created_at, UNIQUE(event_id, student_id))
student_interests(student_id FK, category_id FK, created_at, PK(student_id, category_id))
```

## 2. Keys and referential actions

| Child column | Parent | ON DELETE | Reason |
|---|---|---|---|
| `users.role_id` | `roles` | RESTRICT | a role in use cannot disappear |
| `events.category_id`, `events.venue_id`, `events.organizer_id` | categories / venues / users | RESTRICT | history must not lose its venue/category/organizer |
| `categories.parent_category_id` | `categories` | SET NULL | deleting a parent promotes children to top level |
| `bookings.event_id` | `events` | CASCADE | deleting a (draft) event removes dependent rows |
| `bookings.student_id` | `users` | RESTRICT | students with history cannot be deleted (deactivate instead) |
| `attendance.booking_id` | `bookings` | CASCADE | attendance has no meaning without its booking |
| `feedback.event_id/student_id`, `student_interests.*` | events/users/categories | CASCADE | dependent data |

## 3. Constraints

| Type | Examples |
|---|---|
| PRIMARY KEY | every table (`SERIAL`, composite PK on `student_interests`) |
| FOREIGN KEY | see table above |
| UNIQUE | `users.email`, `roles.role_name`, `venues.name`, `categories.name`, `attendance.booking_id`, `(feedback.event_id, student_id)` |
| NOT NULL | all identifying and business columns |
| DEFAULT | `status` ('draft'/'confirmed'), `is_active TRUE`, `created_at now()`, `description ''` |
| CHECK | e-mail regex, `capacity > 0`, `end_time > start_time`, status enumerations, `rating BETWEEN 1 AND 5`, `(status='cancelled') = (cancelled_at IS NOT NULL)`, `parent <> self`, comment length |
| Partial UNIQUE index | `uq_active_booking (event_id, student_id) WHERE status='confirmed'` - no duplicate bookings, yet re-booking after cancelling works |
| EXCLUDE (GiST) | `ex_events_no_venue_overlap` - one venue cannot host two published/completed events with overlapping time ranges |

`ALTER TABLE` is used in `001_schema.sql` (extra CHECK and EXCLUDE constraints added after creation), in
`003_vector.sql` (`ADD COLUMN embedding vector(384)`) and in the live demo `db/demo/01_ddl.sql` (add column, add constraint, rename, change type).

## 4. Indexes and why they exist

| Index | Columns | Reason (query it serves) |
|---|---|---|
| `idx_users_role`, `idx_events_category`, `idx_events_venue`, `idx_events_organizer`, `idx_bookings_event`, `idx_bookings_student`, `idx_feedback_*`, `idx_categories_parent`, `idx_interests_category` | FK columns | PostgreSQL does **not** index foreign keys automatically; these speed up joins and `ON DELETE` checks |
| `idx_events_status_start` | `(status, start_time)` | event lists always filter by status and sort by date |
| `idx_events_published_start` | `(start_time) WHERE status='published'` | **partial** index: the public listing only reads published events, so the index is smaller and faster |
| `idx_events_cat_status_start` | `(category_id, status, start_time)` | **compound** index for "category filter + published + upcoming, ordered by date" |
| `idx_bookings_event_status` | `(event_id, status)` | seat counting `WHERE event_id=? AND status='confirmed'` (used on every booking) |
| `uq_active_booking` | `(event_id, student_id) WHERE status='confirmed'` | enforces uniqueness and also answers "does this student already hold a seat?" |
| `idx_events_fts` | GIN on `to_tsvector('english', title || ' ' || description)` | keyword search |
| `idx_events_embedding_hnsw` | HNSW on `embedding vector_cosine_ops` | semantic nearest-neighbour search |

`db/demo/04_advanced.sql` (step A13) shows `EXPLAIN` output where the planner uses `idx_events_published_start`, `uq_active_booking` and `idx_events_fts`
(sequential scans are disabled for that demo only, because the demo tables are tiny).

## 5. Functions

| Function | Returns | Purpose |
|---|---|---|
| `confirmed_booking_count(event_id)` | int | confirmed seats taken |
| `seats_remaining(event_id)` | int | capacity minus confirmed |
| `average_event_rating(event_id)` | numeric | mean feedback rating |
| `attendance_rate(event_id)` | numeric | % of confirmed bookings marked present |
| `user_role(user_id)` | text | role lookup used by triggers |
| `semantic_search_events(vector, limit)` | table | pgvector search |
| `similar_events(event_id, limit)` | table | "more like this" via pgvector |

## 6. Triggers

| # | Trigger | Table / timing | Rule |
|---|---|---|---|
| 1 | `event_capacity_check` | events, BEFORE INSERT/UPDATE of capacity, venue_id | event capacity <= venue capacity; cannot drop below confirmed seats |
| 1b | `venue_capacity_guard` | venues, BEFORE UPDATE of capacity | a venue cannot shrink below a planned event |
| 2 | `event_timestamps`, `booking_timestamps` | events / bookings, BEFORE INSERT/UPDATE of status | `cancelled_at` is set (or cleared) by the database |
| 3 | `prevent_overbooking` | bookings, BEFORE INSERT/UPDATE of status, `WHEN status='confirmed'` | locks the event row (`FOR UPDATE`), checks status, end time and free seats |
| 4 | `validate_attendance` | attendance, BEFORE INSERT/UPDATE | booking must be *confirmed*; marker must be the event's organizer or an admin |
| 5 | `bookings_student_only`, `feedback_student_only`, `interests_student_only` | BEFORE INSERT | only role *student* may hold bookings, feedback, interests |
| 6 | `events_organizer_only` | events, BEFORE INSERT/UPDATE of organizer_id | organizer must have role *organizer* or *admin* |
| 7 | `feedback_requires_attendance` | feedback, BEFORE INSERT | student must be marked *present* |
| 8 | `touch_users_updated`, `touch_events_updated` | BEFORE UPDATE | maintains `updated_at` |

Triggers 5-7 are the **database-level RBAC**: even a direct SQL connection cannot create a booking for an organizer or let a student mark attendance.
Custom SQLSTATE codes `UE001`-`UE009` identify each rule; `src/lib/db/errors.ts` turns them into HTTP 400/403/404/409.

## 7. Stored procedures

| Procedure | Behaviour |
|---|---|
| `cancel_event(event_id, actor_id, INOUT cancelled_bookings)` | locks the event, authorises the actor (owner or admin), sets status *cancelled*, cancels all confirmed bookings (one `UPDATE ... RETURNING` inside a CTE), returns the count - all atomic |
| `book_seat(event_id, student_id, INOUT booking_id)` | SQL version of the booking transaction (`SELECT ... FOR UPDATE`, capacity check, insert) |
| `complete_finished_events(INOUT updated)` | marks published events whose end time has passed as *completed* (admin button) |

## 8. Views

| View | Content |
|---|---|
| `v_event_overview` | event + category + venue + organizer + confirmed bookings + seats remaining + attended count + average rating. Used by the API for every event list and by Neo4j sync |
| `v_booking_details` | booking + student + event + venue + attendance |
| `v_category_paths` | **recursive** view producing `Technical > Artificial Intelligence > Machine Learning` and the depth |

## 9. Transactions and concurrency

`src/lib/bookings/service.ts` implements booking as:

```sql
BEGIN;
SELECT capacity, status, end_time FROM events WHERE event_id = $1 FOR UPDATE;   -- row lock
-- verify: published? not ended? no duplicate? count(confirmed) < capacity?
INSERT INTO bookings (event_id, student_id) VALUES ($1, $2);
COMMIT;
```

`FOR UPDATE` makes concurrent requests for the **same event** queue; each one counts seats after the previous one committed (READ COMMITTED
re-reads with a fresh snapshot per statement). Different events do not block each other.
Defence in depth: the `prevent_overbooking` trigger takes the same lock and re-checks, so even code that bypasses the API cannot overbook.
Both layers are tested: `CONCURRENCY: 12 simultaneous bookings for 3 seats -> exactly 3 succeed` and the same with raw `INSERT`s.

Other atomic units: `cancel_event` (procedure), attendance marking (several rows, all-or-nothing), interests replacement.

## 10. Role-based access control inside the data layer
1. **API layer**: every handler starts with `requireUser([roles])` (401/403). Roles are read from PostgreSQL on every request (`getCurrentUser`), never trusted from the cookie.
2. **Ownership**: services check `organizer_id = caller` (or admin) before touching an event; students can only cancel *their own* booking because the SQL has `student_id = caller`.
3. **Database triggers** (list above) repeat the key rules independently of the application.
