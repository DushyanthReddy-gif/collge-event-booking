-- =============================================================================
-- DEMO 03 - JOINs, GROUP BY / HAVING, aggregates, nested, correlated, recursive
-- Read-only. Run: psql -f db/demo/03_queries.sql
-- =============================================================================

\echo '=== Q1  INNER JOIN (2 tables): events with their venue'
SELECT e.title, v.name AS venue, e.capacity, v.capacity AS venue_capacity
FROM events e INNER JOIN venues v ON v.venue_id = e.venue_id
ORDER BY e.start_time LIMIT 5;

\echo '=== Q2  Multiple-table JOIN (5 tables): booking -> student -> event -> category -> venue'
SELECT s.full_name AS student, e.title AS event, c.name AS category, v.name AS venue, b.status
FROM bookings b
JOIN users s      ON s.user_id     = b.student_id
JOIN events e     ON e.event_id    = b.event_id
JOIN categories c ON c.category_id = e.category_id
JOIN venues v     ON v.venue_id    = e.venue_id
WHERE s.email = 'aarav.sharma@college.edu'
ORDER BY e.start_time;

\echo '=== Q3  LEFT JOIN: every event with its confirmed-booking count (0 for drafts / cancelled)'
SELECT e.title, e.status, COUNT(b.booking_id) AS confirmed_bookings
FROM events e LEFT JOIN bookings b ON b.event_id = e.event_id AND b.status = 'confirmed'
GROUP BY e.event_id, e.title, e.status
ORDER BY confirmed_bookings, e.title;

\echo '=== Q4  GROUP BY + aggregates (COUNT, SUM, AVG): fill rate and rating per category'
-- v_event_overview already holds one pre-aggregated row per event, so there is no join fan-out.
SELECT c.name AS category,
       COUNT(*)                                                        AS events,
       SUM(o.confirmed_bookings)                                       AS confirmed_bookings,
       SUM(o.capacity)                                                 AS total_capacity,
       ROUND(100.0 * SUM(o.confirmed_bookings) / SUM(o.capacity), 1)   AS fill_percent,
       ROUND(AVG(o.avg_rating), 2)                                     AS avg_of_event_ratings
FROM v_event_overview o JOIN categories c ON c.category_id = o.category_id
WHERE o.status IN ('published', 'completed')
GROUP BY c.name
ORDER BY confirmed_bookings DESC, category;

\echo '=== Q5  GROUP BY + HAVING: students with at least 3 confirmed bookings'
SELECT s.full_name, COUNT(*) AS confirmed_bookings
FROM bookings b JOIN users s ON s.user_id = b.student_id
WHERE b.status = 'confirmed'
GROUP BY s.user_id, s.full_name
HAVING COUNT(*) >= 3
ORDER BY confirmed_bookings DESC, s.full_name;

\echo '=== Q6  Nested query - subquery in WHERE: students holding a seat in a SOLD-OUT event'
SELECT DISTINCT s.full_name, e.title
FROM bookings b
JOIN users s  ON s.user_id  = b.student_id
JOIN events e ON e.event_id = b.event_id
WHERE b.status = 'confirmed'
  AND b.event_id IN (SELECT event_id FROM v_event_overview
                     WHERE seats_remaining = 0 AND status = 'published');

\echo '=== Q7  Nested query - subquery in FROM (derived table): events above the average booking count'
SELECT t.title, t.bookings
FROM (SELECT e.title, COUNT(b.booking_id) AS bookings
      FROM events e LEFT JOIN bookings b ON b.event_id = e.event_id AND b.status = 'confirmed'
      WHERE e.status IN ('published', 'completed')
      GROUP BY e.event_id, e.title) AS t
WHERE t.bookings > (SELECT AVG(x.cnt) FROM (SELECT COUNT(*) AS cnt FROM bookings
                                            WHERE status = 'confirmed' GROUP BY event_id) AS x)
ORDER BY t.bookings DESC, t.title;

\echo '=== Q8  Nested query - scalar subqueries in SELECT: per-event counts computed inline'
SELECT e.title,
       (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id AND b.status = 'confirmed') AS booked,
       (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id AND b.status = 'cancelled') AS cancelled,
       (SELECT ROUND(AVG(f.rating), 2) FROM feedback f WHERE f.event_id = e.event_id)             AS avg_rating
FROM events e
WHERE e.status IN ('published', 'completed')
ORDER BY booked DESC, e.title
LIMIT 8;

\echo '=== Q9  Correlated query: events booked MORE than the average event of their OWN root category'
-- The inner query references p.path (the outer row's category), so it is re-evaluated per outer row.
SELECT o.title, p.path AS category_path, o.confirmed_bookings
FROM v_event_overview o JOIN v_category_paths p ON p.category_id = o.category_id
WHERE o.status IN ('published', 'completed')
  AND o.confirmed_bookings > (SELECT AVG(o2.confirmed_bookings)
                              FROM v_event_overview o2
                              JOIN v_category_paths p2 ON p2.category_id = o2.category_id
                              WHERE split_part(p2.path, ' > ', 1) = split_part(p.path, ' > ', 1)
                                AND o2.status IN ('published', 'completed'))
ORDER BY p.path, o.confirmed_bookings DESC;

\echo '=== Q10 Correlated EXISTS / NOT EXISTS: students who attended something but never left feedback'
SELECT u.full_name
FROM users u JOIN roles r ON r.role_id = u.role_id
WHERE r.role_name = 'student'
  AND EXISTS     (SELECT 1 FROM bookings b JOIN attendance a ON a.booking_id = b.booking_id
                  WHERE b.student_id = u.user_id AND a.attended)
  AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.student_id = u.user_id)
ORDER BY u.full_name;

\echo '=== Q11 RECURSIVE CTE (1/2): category hierarchy with depth and full path'
WITH RECURSIVE tree AS (
    SELECT category_id, name, 1 AS depth, name::TEXT AS path
    FROM categories WHERE parent_category_id IS NULL
    UNION ALL
    SELECT c.category_id, c.name, t.depth + 1, t.path || ' > ' || c.name
    FROM categories c JOIN tree t ON c.parent_category_id = t.category_id
)
SELECT repeat('   ', depth - 1) || name AS category_tree, depth, path
FROM tree ORDER BY path;

\echo '=== Q12 RECURSIVE CTE (2/2): events per category INCLUDING all sub-categories (roll-up)'
-- "Technical" counts events of AI, Machine Learning, Robotics, Cybersecurity ... at any depth.
WITH RECURSIVE subtree AS (
    SELECT category_id AS root_id, category_id AS node_id FROM categories
    UNION ALL
    SELECT s.root_id, c.category_id
    FROM subtree s JOIN categories c ON c.parent_category_id = s.node_id
)
SELECT r.name AS category, COUNT(DISTINCT e.event_id) AS events_in_subtree
FROM subtree s
JOIN categories r ON r.category_id = s.root_id
LEFT JOIN events e ON e.category_id = s.node_id AND e.status IN ('published', 'completed')
WHERE r.parent_category_id IS NULL
GROUP BY r.name
ORDER BY events_in_subtree DESC, r.name;

\echo '=== Q13 CTE + window function: most popular event inside each root-level category'
WITH ranked AS (
    SELECT p.path, o.title, o.confirmed_bookings,
           RANK() OVER (PARTITION BY split_part(p.path, ' > ', 1)
                        ORDER BY o.confirmed_bookings DESC) AS rnk
    FROM v_event_overview o JOIN v_category_paths p ON p.category_id = o.category_id
    WHERE o.status IN ('published', 'completed')
)
SELECT split_part(path, ' > ', 1) AS root_category, title, confirmed_bookings
FROM ranked WHERE rnk = 1 ORDER BY root_category;

\echo '=== Q14 Attendance analytics: attendance rate and rating for completed events (view + functions)'
SELECT title, confirmed_bookings, attended_count,
       attendance_rate(event_id) AS attendance_pct, avg_rating, rating_count
FROM v_event_overview WHERE status = 'completed' ORDER BY attendance_pct DESC;
