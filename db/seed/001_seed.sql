-- =============================================================================
-- File   : db/seed/001_seed.sql
-- Purpose: Realistic demo data. Every account uses the password  Password@123
--          (hashed with bcrypt via pgcrypto; bcryptjs in the app can verify it).
-- All dates are RELATIVE to now(), so the demo is always "current".
-- Seed order matters because the triggers are active: bookings are created
-- while events are still in the future; "past" events are shifted back in time
-- at the end (simulating time passing).
-- =============================================================================

INSERT INTO roles (role_name, description) VALUES
 ('student',   'Can browse events, book seats, give feedback'),
 ('organizer', 'Can create and manage own events, mark attendance'),
 ('admin',     'Can manage users, venues, categories and all events');

-- ------------------------------ users ----------------------------------------
INSERT INTO users (full_name, email, password_hash, role_id, department)
SELECT v.full_name, v.email, crypt('Password@123', gen_salt('bf', 10)), r.role_id, v.dept
FROM (VALUES
 ('System Admin',        'admin@college.edu',            'admin',     'Administration'),
 ('Prof. Rajesh Kumar',  'rajesh.kumar@college.edu',     'organizer', 'Computer Science'),
 ('Dr. Priya Menon',     'priya.menon@college.edu',      'organizer', 'Student Activities'),
 ('Aarav Sharma',        'aarav.sharma@college.edu',     'student',   'Computer Science'),
 ('Diya Patel',          'diya.patel@college.edu',       'student',   'Electronics'),
 ('Rohan Mehta',         'rohan.mehta@college.edu',      'student',   'Mechanical'),
 ('Ananya Iyer',         'ananya.iyer@college.edu',      'student',   'Computer Science'),
 ('Kabir Singh',         'kabir.singh@college.edu',      'student',   'Information Technology'),
 ('Meera Nair',          'meera.nair@college.edu',       'student',   'Arts'),
 ('Vihaan Gupta',        'vihaan.gupta@college.edu',     'student',   'Computer Science'),
 ('Ishita Rao',          'ishita.rao@college.edu',       'student',   'Electronics'),
 ('Arjun Reddy',         'arjun.reddy@college.edu',      'student',   'Mechanical'),
 ('Sneha Kulkarni',      'sneha.kulkarni@college.edu',   'student',   'Arts')
) AS v(full_name, email, role_name, dept)
JOIN roles r ON r.role_name = v.role_name;

-- ------------------------------ categories (3-level hierarchy) ----------------
INSERT INTO categories (name, description) VALUES
 ('Technical', 'Engineering, computing and technology events'),
 ('Cultural',  'Arts, music and cultural events'),
 ('Sports',    'Tournaments and athletic events'),
 ('Workshop',  'Hands-on skill-building sessions'),
 ('Seminar',   'Talks and guest lectures');

INSERT INTO categories (name, description, parent_category_id)
SELECT v.name, v.descr, p.category_id
FROM (VALUES
 ('Artificial Intelligence', 'AI, deep learning and data science',   'Technical'),
 ('Robotics',                'Robots, embedded systems, automation', 'Technical'),
 ('Cybersecurity',           'Security and ethical hacking',         'Technical'),
 ('Competitive Coding',      'Programming contests and hackathons',  'Technical'),
 ('Music',                   'Concerts and live performances',       'Cultural'),
 ('Photography',             'Photography and visual arts',          'Cultural'),
 ('Cricket',                 'Cricket matches and tournaments',      'Sports'),
 ('Football',                'Football matches and tournaments',     'Sports'),
 ('Entrepreneurship',        'Startups, business and innovation',    'Seminar')
) AS v(name, descr, parent) JOIN categories p ON p.name = v.parent;

INSERT INTO categories (name, description, parent_category_id)
SELECT 'Machine Learning', 'Supervised/unsupervised learning, neural networks', category_id
FROM categories WHERE name = 'Artificial Intelligence';

-- ------------------------------ venues ---------------------------------------
INSERT INTO venues (name, location, capacity) VALUES
 ('Main Auditorium',   'Admin Block, Ground Floor',   500),
 ('Seminar Hall A',    'Academic Block 1, 2nd Floor', 150),
 ('Computer Lab 3',    'CS Building, 1st Floor',       60),
 ('Open Air Theatre',  'Central Campus Lawn',         800),
 ('Sports Ground',     'South Campus',                300);

-- ------------------------------ events ---------------------------------------
-- helper: day offset + hour  ->  timestamptz
CREATE FUNCTION pg_temp.at(p_days INTEGER, p_hour INTEGER) RETURNS TIMESTAMPTZ
LANGUAGE sql AS $$ SELECT date_trunc('day', now()) + make_interval(days => p_days, hours => p_hour) $$;

INSERT INTO events (title, description, category_id, venue_id, organizer_id, start_time, end_time, capacity, status)
SELECT v.title, v.descr, c.category_id, ve.venue_id, o.user_id, pg_temp.at(v.d, v.h1), pg_temp.at(v.d + v.dd, v.h2), v.cap, v.status
FROM (VALUES
 ('Robotics Workshop',
  'Hands-on session building line-following robots using Arduino, sensors and motor drivers. Learn embedded systems and basic automation.',
  'Robotics', 'Computer Lab 3', 'rajesh.kumar@college.edu', 5, 10, 0, 16, 30, 'published'),
 ('AI Seminar: The Future of Generative AI',
  'Industry talk on large language models, neural networks and generative AI, and how they are transforming research and jobs.',
  'Artificial Intelligence', 'Seminar Hall A', 'rajesh.kumar@college.edu', 7, 14, 0, 16, 100, 'published'),
 ('Intercollegiate Coding Competition',
  'Individual programming contest with algorithm and data-structure problems. Languages: C++, Java, Python.',
  'Competitive Coding', 'Computer Lab 3', 'rajesh.kumar@college.edu', 9, 9, 0, 13, 40, 'published'),
 ('Annual Cultural Fest Night',
  'A night of dance, drama and live performances by students from every department, followed by a food festival.',
  'Cultural', 'Open Air Theatre', 'priya.menon@college.edu', 14, 17, 0, 22, 500, 'published'),
 ('Inter-Department Cricket Tournament',
  'Knockout cricket tournament between departments. T10 format, teams of 11. Trophies for winners and best player.',
  'Cricket', 'Sports Ground', 'priya.menon@college.edu', 12, 8, 0, 17, 200, 'published'),
 ('24-Hour Hackathon',
  'Team coding marathon to build software prototypes for real campus problems. Mentors from industry, food and prizes included.',
  'Technical', 'Main Auditorium', 'rajesh.kumar@college.edu', 20, 9, 1, 9, 150, 'published'),
 ('Cybersecurity Seminar: Ethical Hacking Basics',
  'Learn how attackers think: network scanning, password cracking, web vulnerabilities and how to defend against them.',
  'Cybersecurity', 'Seminar Hall A', 'rajesh.kumar@college.edu', 10, 11, 0, 13, 80, 'published'),
 ('Machine Learning Bootcamp',
  'One-day practical bootcamp: train classification and regression models with Python, scikit-learn and neural networks.',
  'Machine Learning', 'Computer Lab 3', 'rajesh.kumar@college.edu', 16, 10, 0, 17, 5, 'published'),
 ('Photography Workshop',
  'Camera basics, composition, lighting and photo editing. Bring your own camera or phone for a campus photo walk.',
  'Photography', 'Seminar Hall A', 'priya.menon@college.edu', 6, 15, 0, 18, 25, 'published'),
 ('Entrepreneurship Talk: From Campus to Startup',
  'Founders share how they turned college projects into funded startups: ideation, funding, mistakes and lessons.',
  'Entrepreneurship', 'Main Auditorium', 'priya.menon@college.edu', 8, 11, 0, 13, 150, 'published'),
 ('Live Music Evening',
  'Student bands and solo artists perform rock, pop and classical fusion under the open sky.',
  'Music', 'Open Air Theatre', 'priya.menon@college.edu', 18, 18, 0, 21, 300, 'published'),
 ('Drone Building Workshop',
  'Assemble and fly a quadcopter: flight controllers, propellers, batteries and safety rules. (Draft - not yet published)',
  'Robotics', 'Computer Lab 3', 'rajesh.kumar@college.edu', 25, 10, 0, 16, 20, 'draft'),
 ('Inter-College Football Friendly',
  'Friendly football match against a neighbouring college. Cancelled due to ground maintenance.',
  'Football', 'Sports Ground', 'priya.menon@college.edu', 13, 15, 0, 18, 100, 'published'),
 -- the next four become PAST events at the end of this script (temporary far-future slots)
 ('Python for Beginners Workshop',
  'Introductory programming workshop: variables, loops, functions and small projects in Python.',
  'Workshop', 'Computer Lab 3', 'rajesh.kumar@college.edu', 400, 10, 0, 14, 40, 'published'),
 ('Data Science Seminar',
  'Seminar on data analysis, visualisation and machine learning pipelines used in industry.',
  'Artificial Intelligence', 'Seminar Hall A', 'rajesh.kumar@college.edu', 410, 10, 0, 12, 100, 'published'),
 ('Annual Sports Day',
  'Athletics, relay races and tug-of-war between departments.',
  'Sports', 'Sports Ground', 'priya.menon@college.edu', 420, 8, 0, 16, 250, 'published'),
 ('Open Mic Night',
  'Poetry, stand-up comedy and acoustic music open to all students.',
  'Music', 'Open Air Theatre', 'priya.menon@college.edu', 430, 18, 0, 21, 200, 'published')
) AS v(title, descr, cat, venue, org, d, h1, dd, h2, cap, status)
JOIN categories c  ON c.name = v.cat
JOIN venues ve     ON ve.name = v.venue
JOIN users o       ON o.email = v.org;

-- ------------------------------ student interests (-> Neo4j LIKES) -------------
INSERT INTO student_interests (student_id, category_id)
SELECT u.user_id, c.category_id
FROM (VALUES
 ('aarav.sharma@college.edu','Artificial Intelligence'), ('aarav.sharma@college.edu','Competitive Coding'),
 ('diya.patel@college.edu','Robotics'),                  ('diya.patel@college.edu','Music'),
 ('rohan.mehta@college.edu','Cricket'),                  ('rohan.mehta@college.edu','Robotics'),
 ('ananya.iyer@college.edu','Machine Learning'),         ('ananya.iyer@college.edu','Cybersecurity'),
 ('kabir.singh@college.edu','Cybersecurity'),            ('kabir.singh@college.edu','Cricket'),
 ('meera.nair@college.edu','Photography'),               ('meera.nair@college.edu','Music'),
 ('vihaan.gupta@college.edu','Artificial Intelligence'), ('ishita.rao@college.edu','Entrepreneurship'),
 ('arjun.reddy@college.edu','Football'),                 ('sneha.kulkarni@college.edu','Cultural')
) AS v(email, cat)
JOIN users u ON u.email = v.email JOIN categories c ON c.name = v.cat;

-- ------------------------------ bookings -------------------------------------
CREATE TEMP TABLE seed_bookings (title TEXT, email TEXT);
INSERT INTO seed_bookings VALUES
 ('Robotics Workshop','aarav.sharma@college.edu'), ('Robotics Workshop','diya.patel@college.edu'),
 ('Robotics Workshop','rohan.mehta@college.edu'),  ('Robotics Workshop','kabir.singh@college.edu'),
 ('AI Seminar: The Future of Generative AI','aarav.sharma@college.edu'),
 ('AI Seminar: The Future of Generative AI','ananya.iyer@college.edu'),
 ('AI Seminar: The Future of Generative AI','meera.nair@college.edu'),
 ('AI Seminar: The Future of Generative AI','vihaan.gupta@college.edu'),
 ('AI Seminar: The Future of Generative AI','ishita.rao@college.edu'),
 ('Intercollegiate Coding Competition','aarav.sharma@college.edu'), ('Intercollegiate Coding Competition','kabir.singh@college.edu'),
 ('Intercollegiate Coding Competition','arjun.reddy@college.edu'),  ('Intercollegiate Coding Competition','vihaan.gupta@college.edu'),
 ('Annual Cultural Fest Night','diya.patel@college.edu'),   ('Annual Cultural Fest Night','meera.nair@college.edu'),
 ('Annual Cultural Fest Night','ishita.rao@college.edu'),   ('Annual Cultural Fest Night','sneha.kulkarni@college.edu'),
 ('Annual Cultural Fest Night','ananya.iyer@college.edu'),  ('Annual Cultural Fest Night','rohan.mehta@college.edu'),
 ('Inter-Department Cricket Tournament','rohan.mehta@college.edu'), ('Inter-Department Cricket Tournament','kabir.singh@college.edu'),
 ('Inter-Department Cricket Tournament','arjun.reddy@college.edu'), ('Inter-Department Cricket Tournament','vihaan.gupta@college.edu'),
 ('24-Hour Hackathon','aarav.sharma@college.edu'), ('24-Hour Hackathon','ananya.iyer@college.edu'),
 ('24-Hour Hackathon','kabir.singh@college.edu'),  ('24-Hour Hackathon','vihaan.gupta@college.edu'),
 ('24-Hour Hackathon','arjun.reddy@college.edu'),
 ('Cybersecurity Seminar: Ethical Hacking Basics','ananya.iyer@college.edu'),
 ('Cybersecurity Seminar: Ethical Hacking Basics','kabir.singh@college.edu'),
 ('Cybersecurity Seminar: Ethical Hacking Basics','sneha.kulkarni@college.edu'),
 ('Machine Learning Bootcamp','aarav.sharma@college.edu'), ('Machine Learning Bootcamp','ananya.iyer@college.edu'),
 ('Machine Learning Bootcamp','vihaan.gupta@college.edu'), ('Machine Learning Bootcamp','ishita.rao@college.edu'),
 ('Machine Learning Bootcamp','arjun.reddy@college.edu'),   -- 5 of 5 seats: sold out
 ('Photography Workshop','diya.patel@college.edu'), ('Photography Workshop','meera.nair@college.edu'),
 ('Photography Workshop','sneha.kulkarni@college.edu'),
 ('Entrepreneurship Talk: From Campus to Startup','ishita.rao@college.edu'),
 ('Entrepreneurship Talk: From Campus to Startup','arjun.reddy@college.edu'),
 ('Entrepreneurship Talk: From Campus to Startup','sneha.kulkarni@college.edu'),
 ('Live Music Evening','diya.patel@college.edu'), ('Live Music Evening','meera.nair@college.edu'),
 ('Live Music Evening','sneha.kulkarni@college.edu'), ('Live Music Evening','ishita.rao@college.edu'),
 ('Inter-College Football Friendly','rohan.mehta@college.edu'), ('Inter-College Football Friendly','kabir.singh@college.edu'),
 ('Inter-College Football Friendly','arjun.reddy@college.edu'),
 ('Python for Beginners Workshop','aarav.sharma@college.edu'), ('Python for Beginners Workshop','diya.patel@college.edu'),
 ('Python for Beginners Workshop','rohan.mehta@college.edu'),  ('Python for Beginners Workshop','ananya.iyer@college.edu'),
 ('Python for Beginners Workshop','kabir.singh@college.edu'),  ('Python for Beginners Workshop','sneha.kulkarni@college.edu'),
 ('Data Science Seminar','aarav.sharma@college.edu'), ('Data Science Seminar','ananya.iyer@college.edu'),
 ('Data Science Seminar','vihaan.gupta@college.edu'), ('Data Science Seminar','ishita.rao@college.edu'),
 ('Data Science Seminar','arjun.reddy@college.edu'),
 ('Annual Sports Day','rohan.mehta@college.edu'), ('Annual Sports Day','kabir.singh@college.edu'),
 ('Annual Sports Day','arjun.reddy@college.edu'), ('Annual Sports Day','vihaan.gupta@college.edu'),
 ('Annual Sports Day','meera.nair@college.edu'),
 ('Open Mic Night','diya.patel@college.edu'), ('Open Mic Night','meera.nair@college.edu'),
 ('Open Mic Night','sneha.kulkarni@college.edu'), ('Open Mic Night','ishita.rao@college.edu');

INSERT INTO bookings (event_id, student_id)
SELECT e.event_id, u.user_id FROM seed_bookings sb
JOIN events e ON e.title = sb.title JOIN users u ON u.email = sb.email
ORDER BY e.event_id, u.user_id;

-- one student books and then cancels (shows a cancelled booking + trigger-set timestamp)
INSERT INTO bookings (event_id, student_id)
SELECT e.event_id, u.user_id FROM events e, users u
WHERE e.title = 'AI Seminar: The Future of Generative AI' AND u.email = 'rohan.mehta@college.edu';
UPDATE bookings SET status = 'cancelled'
WHERE student_id = (SELECT user_id FROM users WHERE email = 'rohan.mehta@college.edu')
  AND event_id = (SELECT event_id FROM events WHERE title = 'AI Seminar: The Future of Generative AI');

-- cancel the football friendly through the stored procedure
-- TEMPORARILY DISABLED FOR DEBUGGING

-- ------------------------------ attendance for the four past events -------------
INSERT INTO attendance (booking_id, attended, marked_by)
SELECT b.booking_id,
       NOT ((e.title = 'Python for Beginners Workshop' AND u.email = 'sneha.kulkarni@college.edu')
         OR (e.title = 'Data Science Seminar'          AND u.email = 'arjun.reddy@college.edu')
         OR (e.title = 'Annual Sports Day'             AND u.email = 'meera.nair@college.edu')),
       e.organizer_id
FROM bookings b JOIN events e ON e.event_id = b.event_id JOIN users u ON u.user_id = b.student_id
WHERE e.title IN ('Python for Beginners Workshop','Data Science Seminar','Annual Sports Day','Open Mic Night')
  AND b.status = 'confirmed';

-- ------------------------------ feedback -------------------------------------
INSERT INTO feedback (event_id, student_id, rating, comment)
SELECT e.event_id, u.user_id, v.rating, v.comment
FROM (VALUES
 ('Python for Beginners Workshop','aarav.sharma@college.edu', 5,'Very clear explanations and great exercises.'),
 ('Python for Beginners Workshop','diya.patel@college.edu',   4,'Good pace for beginners.'),
 ('Python for Beginners Workshop','rohan.mehta@college.edu',  4,'Useful, would like more projects.'),
 ('Python for Beginners Workshop','ananya.iyer@college.edu',  5,'Loved the live coding.'),
 ('Data Science Seminar','aarav.sharma@college.edu', 5,'Excellent real-world examples.'),
 ('Data Science Seminar','ananya.iyer@college.edu',  5,'Best seminar this semester.'),
 ('Data Science Seminar','vihaan.gupta@college.edu', 4,'Informative, slightly too fast.'),
 ('Data Science Seminar','ishita.rao@college.edu',   3,'Good content but the room was crowded.'),
 ('Annual Sports Day','rohan.mehta@college.edu', 5,'Great energy all day.'),
 ('Annual Sports Day','kabir.singh@college.edu', 4,'Well organised.'),
 ('Annual Sports Day','arjun.reddy@college.edu', 4,'Fun relay races.'),
 ('Open Mic Night','diya.patel@college.edu',  5,'Amazing performances!'),
 ('Open Mic Night','meera.nair@college.edu',  5,'Loved the poetry round.'),
 ('Open Mic Night','ishita.rao@college.edu',  4,'Great atmosphere.')
) AS v(title, email, rating, comment)
JOIN events e ON e.title = v.title JOIN users u ON u.email = v.email;

-- ------------------------------ move the four events into the past ----------------
UPDATE events SET start_time = pg_temp.at(-30, 10), end_time = pg_temp.at(-30, 14), status = 'completed' WHERE title = 'Python for Beginners Workshop';
UPDATE events SET start_time = pg_temp.at(-20, 10), end_time = pg_temp.at(-20, 12), status = 'completed' WHERE title = 'Data Science Seminar';
UPDATE events SET start_time = pg_temp.at(-45, 8),  end_time = pg_temp.at(-45, 16), status = 'completed' WHERE title = 'Annual Sports Day';
UPDATE events SET start_time = pg_temp.at(-10, 18), end_time = pg_temp.at(-10, 21), status = 'completed' WHERE title = 'Open Mic Night';

-- back-date history so charts/timelines look natural
UPDATE bookings b SET booked_at = e.start_time - interval '9 days'
FROM events e WHERE e.event_id = b.event_id AND e.status = 'completed';
UPDATE attendance a SET marked_at = e.end_time
FROM bookings b JOIN events e ON e.event_id = b.event_id WHERE b.booking_id = a.booking_id AND e.status = 'completed';
UPDATE feedback f SET created_at = e.end_time + interval '1 day'
FROM events e WHERE e.event_id = f.event_id;
UPDATE bookings SET booked_at = now() - interval '2 days' WHERE status = 'confirmed' AND booked_at > now() - interval '1 hour';
