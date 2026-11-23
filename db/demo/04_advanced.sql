-- =============================================================================
-- DEMO 04 - Functions, procedures, triggers, transactions, views, indexes
-- Safe to repeat: everything that changes data is inside BEGIN ... ROLLBACK, and
-- trigger violations are caught with DO blocks so the script never aborts.
-- Run: psql -f db/demo/04_advanced.sql
-- =============================================================================

\echo '=== A1  FUNCTIONS'
SELECT title,
       confirmed_booking_count(event_id) AS booked,
       seats_remaining(event_id)         AS free,
       average_event_rating(event_id)    AS rating,
       attendance_rate(event_id)         AS attendance_pct
FROM events WHERE status IN ('published', 'completed') ORDER BY event_id LIMIT 8;

\echo '=== A2  VIEW v_event_overview (event + category + venue + organizer + counts + rating)'
SELECT event_id, title, category_name, venue_name, organizer_name, confirmed_bookings, seats_remaining, avg_rating
FROM v_event_overview WHERE status = 'published' ORDER BY start_time LIMIT 5;

\echo '=== A3  TRIGGER 1 - event capacity may not exceed venue capacity (Computer Lab 3 holds 60)'
DO $$ BEGIN
  INSERT INTO events (title, category_id, venue_id, organizer_id, start_time, end_time, capacity, status)
  VALUES ('Too Big Event', (SELECT category_id FROM categories WHERE name = 'Robotics'),
          (SELECT venue_id FROM venues WHERE name = 'Computer Lab 3'),
          (SELECT user_id FROM users WHERE email = 'rajesh.kumar@college.edu'),
          now() + interval '90 days', now() + interval '90 days 2 hours', 61, 'draft');
EXCEPTION WHEN SQLSTATE 'UE001' THEN RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM; END $$;

\echo '=== A4  TRIGGER 2 - cancellation timestamps are set automatically'
BEGIN;
  UPDATE bookings SET status = 'cancelled'
  WHERE booking_id = (SELECT MIN(booking_id) FROM bookings WHERE status = 'confirmed')
  RETURNING booking_id, status, cancelled_at;     -- cancelled_at filled in by the trigger
ROLLBACK;

\echo '=== A5  TRIGGER 3 - overbooking is impossible (Machine Learning Bootcamp has 5 of 5 seats taken)'
DO $$ BEGIN
  INSERT INTO bookings (event_id, student_id)
  VALUES ((SELECT event_id FROM events WHERE title = 'Machine Learning Bootcamp'),
          (SELECT user_id  FROM users  WHERE email = 'diya.patel@college.edu'));
EXCEPTION WHEN SQLSTATE 'UE002' THEN RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM; END $$;

\echo '=== A6  TRIGGER 4 - attendance only for confirmed bookings (booking belongs to the cancelled football event)'
DO $$ BEGIN
  INSERT INTO attendance (booking_id, attended, marked_by)
  VALUES ((SELECT b.booking_id FROM bookings b JOIN events e ON e.event_id = b.event_id
           WHERE e.title = 'Inter-College Football Friendly' LIMIT 1), TRUE,
          (SELECT user_id FROM users WHERE email = 'priya.menon@college.edu'));
EXCEPTION WHEN SQLSTATE 'UE004' THEN RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM; END $$;

\echo '=== A7  ROLE RULES inside the database: an organizer cannot hold a booking; a student cannot own events'
DO $$ BEGIN
  INSERT INTO bookings (event_id, student_id)
  VALUES ((SELECT event_id FROM events WHERE title = 'Photography Workshop'),
          (SELECT user_id  FROM users  WHERE email = 'rajesh.kumar@college.edu'));
EXCEPTION WHEN SQLSTATE 'UE005' THEN RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM; END $$;
DO $$ BEGIN
  INSERT INTO events (title, category_id, venue_id, organizer_id, start_time, end_time, capacity)
  VALUES ('Student Event', (SELECT category_id FROM categories WHERE name = 'Music'),
          (SELECT venue_id FROM venues WHERE name = 'Seminar Hall A'),
          (SELECT user_id FROM users WHERE email = 'aarav.sharma@college.edu'),
          now() + interval '60 days', now() + interval '60 days 2 hours', 20);
EXCEPTION WHEN SQLSTATE 'UE005' THEN RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM; END $$;

\echo '=== A8  Feedback requires attendance (Kabir never attended a Music event)'
DO $$ BEGIN
  INSERT INTO feedback (event_id, student_id, rating)
  VALUES ((SELECT event_id FROM events WHERE title = 'Open Mic Night'),
          (SELECT user_id  FROM users  WHERE email = 'kabir.singh@college.edu'), 5);
EXCEPTION WHEN SQLSTATE 'UE006' THEN RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM; END $$;

\echo '=== A9  Venue clash is rejected by the EXCLUDE constraint (same venue, overlapping time)'
DO $$ BEGIN
  INSERT INTO events (title, category_id, venue_id, organizer_id, start_time, end_time, capacity, status)
  SELECT 'Clashing Event', category_id, venue_id, organizer_id, start_time + interval '1 hour', end_time, 10, 'published'
  FROM events WHERE title = 'Robotics Workshop';
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'BLOCKED by EXCLUDE constraint: venue already booked'; END $$;

\echo '=== A10 STORED PROCEDURE cancel_event: cancels the event AND all its bookings atomically'
SELECT event_id AS ev FROM events WHERE title = 'Live Music Evening' \gset
SELECT user_id AS actor FROM users WHERE email = 'priya.menon@college.edu' \gset
BEGIN;
  CALL cancel_event(:ev, :actor, NULL);          -- returns the number of cancelled bookings
  SELECT status, cancelled_at IS NOT NULL AS cancelled_at_set FROM events WHERE event_id = :ev;
  SELECT status, COUNT(*) FROM bookings WHERE event_id = :ev GROUP BY status;
ROLLBACK;
\echo '    (ROLLBACK undid everything - the event is still published)'

\echo '    The procedure also enforces authorisation: a different organizer is refused'
DO $$
DECLARE n INTEGER := 0; ev INTEGER; actor INTEGER;
BEGIN
  SELECT event_id INTO ev    FROM events WHERE title = 'Live Music Evening';
  SELECT user_id  INTO actor FROM users  WHERE email = 'rajesh.kumar@college.edu';
  CALL cancel_event(ev, actor, n);
EXCEPTION WHEN SQLSTATE 'UE007' THEN RAISE NOTICE 'BLOCKED by procedure: %', SQLERRM; END $$;

\echo '=== A11 TRANSACTION with row-level locking (what the API does for every booking)'
BEGIN;
  -- 1. lock the event row: concurrent bookings for the same event now queue up here
  SELECT event_id, capacity, status FROM events WHERE title = 'Photography Workshop' FOR UPDATE;
  -- 2. verify capacity while holding the lock
  SELECT capacity - confirmed_booking_count(event_id) AS free_seats FROM events WHERE title = 'Photography Workshop';
  -- 3. insert the booking
  INSERT INTO bookings (event_id, student_id)
  SELECT e.event_id, u.user_id FROM events e, users u
  WHERE e.title = 'Photography Workshop' AND u.email = 'ananya.iyer@college.edu' RETURNING booking_id, status;
ROLLBACK;   -- use COMMIT in the real application

\echo '=== A12 Booking procedure book_seat (same logic, pure SQL)'
SELECT event_id AS ev  FROM events WHERE title = 'Photography Workshop' \gset
SELECT user_id  AS stu FROM users  WHERE email = 'ananya.iyer@college.edu' \gset
BEGIN;
  CALL book_seat(:ev, :stu, NULL);               -- returns the new booking_id
ROLLBACK;

\echo '=== A13 INDEX usage: EXPLAIN the compound / partial indexes'
SET enable_seqscan = off;   -- the demo tables are tiny, so force the planner to show the index
EXPLAIN (COSTS OFF) SELECT title FROM events WHERE status = 'published' AND start_time > now() ORDER BY start_time;
EXPLAIN (COSTS OFF) SELECT booking_id FROM bookings WHERE event_id = 1 AND status = 'confirmed';
EXPLAIN (COSTS OFF) SELECT title FROM events WHERE to_tsvector('english', title || ' ' || description) @@ websearch_to_tsquery('english', 'robot');
RESET enable_seqscan;

\echo '=== A14 Concurrency demo (manual, two terminals) is described in docs/DEMO_GUIDE.md step 23'
