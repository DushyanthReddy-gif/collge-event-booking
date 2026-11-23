-- =============================================================================
-- DEMO 02 - DML (INSERT / SELECT / UPDATE / DELETE)
-- Everything destructive runs inside a transaction that is ROLLED BACK, so the
-- data is unchanged afterwards. Run: psql -f db/demo/02_dml.sql
-- =============================================================================
BEGIN;

\echo '--- INSERT: a new venue, a new draft event, and a new student'
INSERT INTO venues (name, location, capacity) VALUES ('Demo Hall', 'Annex Block', 80);

INSERT INTO events (title, description, category_id, venue_id, organizer_id, start_time, end_time, capacity, status)
VALUES ('Demo: Intro to IoT',
        'Internet of Things basics with sensors and microcontrollers',
        (SELECT category_id FROM categories WHERE name = 'Robotics'),
        (SELECT venue_id    FROM venues     WHERE name = 'Demo Hall'),
        (SELECT user_id     FROM users      WHERE email = 'rajesh.kumar@college.edu'),
        now() + interval '40 days', now() + interval '40 days 3 hours', 50, 'draft')
RETURNING event_id, title, status;

INSERT INTO users (full_name, email, password_hash, role_id, department)
VALUES ('Demo Student', 'demo.student@college.edu', crypt('Password@123', gen_salt('bf')),
        (SELECT role_id FROM roles WHERE role_name = 'student'), 'Computer Science')
RETURNING user_id, email, left(password_hash, 7) AS hash_prefix;

\echo '--- SELECT: read the rows we just created'
SELECT event_id, title, status, capacity FROM events WHERE title LIKE 'Demo:%';

\echo '--- UPDATE: publish the event, then raise its capacity'
UPDATE events SET status = 'published' WHERE title = 'Demo: Intro to IoT' RETURNING event_id, status;
UPDATE events SET capacity = 60        WHERE title = 'Demo: Intro to IoT' RETURNING event_id, capacity;

\echo '--- INSERT a booking for the demo student, then UPDATE it to cancelled (trigger sets cancelled_at)'
INSERT INTO bookings (event_id, student_id)
SELECT e.event_id, u.user_id FROM events e, users u
WHERE e.title = 'Demo: Intro to IoT' AND u.email = 'demo.student@college.edu'
RETURNING booking_id, status, booked_at;

UPDATE bookings SET status = 'cancelled'
WHERE student_id = (SELECT user_id FROM users WHERE email = 'demo.student@college.edu')
RETURNING booking_id, status, cancelled_at;

\echo '--- DELETE: remove the booking, the event, the venue and the user'
DELETE FROM bookings WHERE student_id = (SELECT user_id FROM users WHERE email = 'demo.student@college.edu');
DELETE FROM events   WHERE title = 'Demo: Intro to IoT';
DELETE FROM venues   WHERE name  = 'Demo Hall';
DELETE FROM users    WHERE email = 'demo.student@college.edu';

\echo '--- DELETE blocked by referential integrity (RESTRICT): try deleting a venue that has events'
SAVEPOINT before_bad_delete;
DO $$ BEGIN
  DELETE FROM venues WHERE name = 'Main Auditorium';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ON DELETE RESTRICT protected venue "Main Auditorium"'; END $$;

\echo '--- verify nothing from the demo is left'
SELECT (SELECT count(*) FROM events WHERE title LIKE 'Demo:%') AS demo_events,
       (SELECT count(*) FROM venues WHERE name = 'Demo Hall')  AS demo_venues;

ROLLBACK;   -- the live data is untouched

\echo '--- after ROLLBACK the database is exactly as before:'
SELECT count(*) AS total_events FROM events;
