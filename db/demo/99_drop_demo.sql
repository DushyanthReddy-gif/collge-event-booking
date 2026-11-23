-- =============================================================================
-- DEMO 99 - cleanup. Removes anything the demo scripts could leave behind.
-- The scripts are written to clean up after themselves; this is the safety net.
-- =============================================================================
DROP TABLE IF EXISTS demo_event_tags;
DELETE FROM bookings WHERE student_id IN (SELECT user_id FROM users WHERE email = 'demo.student@college.edu');
DELETE FROM events   WHERE title LIKE 'Demo:%' OR title IN ('Too Big Event', 'Student Event', 'Clashing Event');
DELETE FROM users    WHERE email = 'demo.student@college.edu';
DELETE FROM venues   WHERE name = 'Demo Hall';
\echo 'Demo objects removed.'
