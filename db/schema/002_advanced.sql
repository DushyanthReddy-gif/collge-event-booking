-- =============================================================================
-- File   : db/schema/002_advanced.sql
-- Purpose: Functions, triggers, stored procedures and views.
--
-- Custom SQLSTATE codes raised by this file (class 'UE' = application-defined):
--   UE001 event capacity exceeds venue capacity
--   UE002 overbooking / capacity below confirmed bookings
--   UE003 event not open for booking
--   UE004 attendance on a non-confirmed booking
--   UE005 role violation (wrong role for the column, or actor not allowed)
--   UE006 feedback without attendance
--   UE007 procedure caller is not the organizer/admin
--   UE008 record not found
--   UE009 invalid state for the requested operation (e.g. event already cancelled)
-- The Next.js API maps these codes to HTTP 409/403/404 (src/lib/db/errors.ts).
-- =============================================================================

-- ------------------------------ helper functions ------------------------------
CREATE OR REPLACE FUNCTION user_role(p_user_id INTEGER) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = p_user_id
$$;

-- FUNCTION 1: number of confirmed bookings for an event
CREATE OR REPLACE FUNCTION confirmed_booking_count(p_event_id INTEGER) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
    SELECT COUNT(*)::INTEGER FROM bookings WHERE event_id = p_event_id AND status = 'confirmed'
$$;

-- FUNCTION 2: seats still free (NULL when the event does not exist)
CREATE OR REPLACE FUNCTION seats_remaining(p_event_id INTEGER) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
    SELECT e.capacity - confirmed_booking_count(e.event_id) FROM events e WHERE e.event_id = p_event_id
$$;

-- FUNCTION 3: average rating
CREATE OR REPLACE FUNCTION average_event_rating(p_event_id INTEGER) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT ROUND(AVG(rating)::NUMERIC, 2) FROM feedback WHERE event_id = p_event_id
$$;

-- FUNCTION 4: percentage of confirmed bookings that actually attended
CREATE OR REPLACE FUNCTION attendance_rate(p_event_id INTEGER) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN confirmed_booking_count(p_event_id) = 0 THEN 0
           ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE a.attended)
                      / confirmed_booking_count(p_event_id), 1) END
    FROM bookings b JOIN attendance a ON a.booking_id = b.booking_id
    WHERE b.event_id = p_event_id AND b.status = 'confirmed'
$$;

-- generic updated_at maintenance
CREATE OR REPLACE FUNCTION trg_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER touch_users_updated  BEFORE UPDATE ON users  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE TRIGGER touch_events_updated BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- TRIGGER 1: event capacity can never exceed venue capacity (and can never be
--            lowered below the seats that are already confirmed).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_event_capacity_check() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_venue_capacity INTEGER;
BEGIN
    SELECT capacity INTO v_venue_capacity FROM venues WHERE venue_id = NEW.venue_id;
    IF NEW.capacity > v_venue_capacity THEN
        RAISE EXCEPTION 'Event capacity (%) exceeds venue capacity (%)', NEW.capacity, v_venue_capacity
            USING ERRCODE = 'UE001';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.capacity < confirmed_booking_count(NEW.event_id) THEN
        RAISE EXCEPTION 'Capacity % is below the % seats already booked',
            NEW.capacity, confirmed_booking_count(NEW.event_id) USING ERRCODE = 'UE002';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER event_capacity_check
    BEFORE INSERT OR UPDATE OF capacity, venue_id ON events
    FOR EACH ROW EXECUTE FUNCTION trg_event_capacity_check();

-- Shrinking a venue must not invalidate events that are still planned.
CREATE OR REPLACE FUNCTION trg_venue_capacity_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM events
               WHERE venue_id = NEW.venue_id AND status IN ('draft', 'published')
                 AND capacity > NEW.capacity) THEN
        RAISE EXCEPTION 'Venue capacity % is smaller than a planned event at this venue', NEW.capacity
            USING ERRCODE = 'UE001';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER venue_capacity_guard
    BEFORE UPDATE OF capacity ON venues
    FOR EACH ROW EXECUTE FUNCTION trg_venue_capacity_guard();

-- ----------------------------------------------------------------------------
-- TRIGGER 2: cancellation timestamps are maintained by the database
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_event_timestamps() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'cancelled' THEN
        NEW.cancelled_at := COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.cancelled_at END, now());
    ELSE
        NEW.cancelled_at := NULL;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER event_timestamps
    BEFORE INSERT OR UPDATE OF status ON events
    FOR EACH ROW EXECUTE FUNCTION trg_event_timestamps();

CREATE OR REPLACE FUNCTION trg_booking_timestamps() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'cancelled' THEN
        NEW.cancelled_at := COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.cancelled_at END, now());
    ELSE
        NEW.cancelled_at := NULL;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER booking_timestamps
    BEFORE INSERT OR UPDATE OF status ON bookings
    FOR EACH ROW EXECUTE FUNCTION trg_booking_timestamps();

-- ----------------------------------------------------------------------------
-- TRIGGER 3: prevent overbooking (last line of defence, concurrency-safe).
-- The event row is locked with FOR UPDATE, so two concurrent bookings for the
-- same event are serialised: the second one waits, then sees the first one.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_prevent_overbooking() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_capacity INTEGER;
    v_status   TEXT;
    v_end      TIMESTAMPTZ;
    v_taken    INTEGER;
BEGIN
    SELECT capacity, status, end_time INTO v_capacity, v_status, v_end
    FROM events WHERE event_id = NEW.event_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event % does not exist', NEW.event_id USING ERRCODE = 'UE008';
    END IF;
    IF v_status <> 'published' OR v_end <= now() THEN
        RAISE EXCEPTION 'Event % is not open for booking', NEW.event_id USING ERRCODE = 'UE003';
    END IF;

    SELECT COUNT(*) INTO v_taken FROM bookings
    WHERE event_id = NEW.event_id AND status = 'confirmed'
      AND booking_id IS DISTINCT FROM NEW.booking_id;

    IF v_taken >= v_capacity THEN
        RAISE EXCEPTION 'Event % is fully booked (% of % seats)', NEW.event_id, v_taken, v_capacity
            USING ERRCODE = 'UE002';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER prevent_overbooking
    BEFORE INSERT OR UPDATE OF status ON bookings
    FOR EACH ROW WHEN (NEW.status = 'confirmed')
    EXECUTE FUNCTION trg_prevent_overbooking();

-- ----------------------------------------------------------------------------
-- TRIGGER 4: attendance only for confirmed bookings, only by the event's
--            organizer or an admin (role rule enforced inside the database).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validate_attendance() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_status    TEXT;
    v_organizer INTEGER;
BEGIN
    SELECT b.status, e.organizer_id INTO v_status, v_organizer
    FROM bookings b JOIN events e ON e.event_id = b.event_id
    WHERE b.booking_id = NEW.booking_id;

    IF v_status IS DISTINCT FROM 'confirmed' THEN
        RAISE EXCEPTION 'Attendance can only be marked for a confirmed booking (booking %)', NEW.booking_id
            USING ERRCODE = 'UE004';
    END IF;
    IF user_role(NEW.marked_by) IS DISTINCT FROM 'admin' AND NEW.marked_by <> v_organizer THEN
        RAISE EXCEPTION 'User % may not mark attendance for this event', NEW.marked_by
            USING ERRCODE = 'UE005';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER validate_attendance
    BEFORE INSERT OR UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION trg_validate_attendance();

-- ----------------------------------------------------------------------------
-- ROLE TRIGGERS (RBAC inside the database)
--   * only students may hold bookings / feedback / interests
--   * only organizers or admins may organise events
--   * feedback requires attended = TRUE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_require_student() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF user_role(NEW.student_id) IS DISTINCT FROM 'student' THEN
        RAISE EXCEPTION 'User % is not a student', NEW.student_id USING ERRCODE = 'UE005';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER bookings_student_only  BEFORE INSERT ON bookings
    FOR EACH ROW EXECUTE FUNCTION trg_require_student();
CREATE TRIGGER feedback_student_only  BEFORE INSERT ON feedback
    FOR EACH ROW EXECUTE FUNCTION trg_require_student();
CREATE TRIGGER interests_student_only BEFORE INSERT ON student_interests
    FOR EACH ROW EXECUTE FUNCTION trg_require_student();

CREATE OR REPLACE FUNCTION trg_event_organizer_role() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF user_role(NEW.organizer_id) NOT IN ('organizer', 'admin') THEN
        RAISE EXCEPTION 'User % is not allowed to organise events', NEW.organizer_id USING ERRCODE = 'UE005';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER events_organizer_only
    BEFORE INSERT OR UPDATE OF organizer_id ON events
    FOR EACH ROW EXECUTE FUNCTION trg_event_organizer_role();

CREATE OR REPLACE FUNCTION trg_feedback_requires_attendance() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM bookings b JOIN attendance a ON a.booking_id = b.booking_id
        WHERE b.event_id = NEW.event_id AND b.student_id = NEW.student_id
          AND b.status = 'confirmed' AND a.attended
    ) THEN
        RAISE EXCEPTION 'Feedback is only allowed for students who attended the event'
            USING ERRCODE = 'UE006';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER feedback_requires_attendance
    BEFORE INSERT ON feedback
    FOR EACH ROW EXECUTE FUNCTION trg_feedback_requires_attendance();

-- ----------------------------------------------------------------------------
-- STORED PROCEDURE 1: cancel_event
-- Atomically: lock event -> authorise actor -> cancel event -> cancel every
-- confirmed booking. Returns the number of cancelled bookings (INOUT).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE cancel_event(
    IN    p_event_id INTEGER,
    IN    p_actor_id INTEGER,
    INOUT p_cancelled_bookings INTEGER DEFAULT 0
)
LANGUAGE plpgsql AS $$
DECLARE
    v_organizer INTEGER;
    v_status    TEXT;
BEGIN
    SELECT organizer_id, status INTO v_organizer, v_status
    FROM events WHERE event_id = p_event_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event % not found', p_event_id USING ERRCODE = 'UE008';
    END IF;
    IF user_role(p_actor_id) IS DISTINCT FROM 'admin' AND v_organizer <> p_actor_id THEN
        RAISE EXCEPTION 'User % may not cancel event %', p_actor_id, p_event_id USING ERRCODE = 'UE007';
    END IF;
    IF v_status IN ('cancelled', 'completed') THEN
        RAISE EXCEPTION 'Event % is already %', p_event_id, v_status USING ERRCODE = 'UE009';
    END IF;

    UPDATE events SET status = 'cancelled' WHERE event_id = p_event_id;

    WITH cancelled AS (
        UPDATE bookings SET status = 'cancelled'
        WHERE event_id = p_event_id AND status = 'confirmed'
        RETURNING 1
    )
    SELECT COUNT(*)::INTEGER INTO p_cancelled_bookings FROM cancelled;
END $$;

-- ----------------------------------------------------------------------------
-- STORED PROCEDURE 2: book_seat  (pure-SQL version of the booking transaction;
-- the Next.js code implements the same steps in src/lib/bookings/service.ts)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE book_seat(
    IN    p_event_id   INTEGER,
    IN    p_student_id INTEGER,
    INOUT p_booking_id INTEGER DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
    v_capacity INTEGER;
    v_status   TEXT;
BEGIN
    SELECT capacity, status INTO v_capacity, v_status
    FROM events WHERE event_id = p_event_id FOR UPDATE;          -- row lock

    IF NOT FOUND OR v_status <> 'published' THEN
        RAISE EXCEPTION 'Event % is not open for booking', p_event_id USING ERRCODE = 'UE003';
    END IF;
    IF confirmed_booking_count(p_event_id) >= v_capacity THEN
        RAISE EXCEPTION 'Event % is fully booked', p_event_id USING ERRCODE = 'UE002';
    END IF;

    INSERT INTO bookings (event_id, student_id) VALUES (p_event_id, p_student_id)
    RETURNING booking_id INTO p_booking_id;
END $$;

-- ----------------------------------------------------------------------------
-- STORED PROCEDURE 3: mark published events whose end time has passed as completed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE complete_finished_events(INOUT p_updated INTEGER DEFAULT 0)
LANGUAGE plpgsql AS $$
BEGIN
    WITH done AS (
        UPDATE events SET status = 'completed'
        WHERE status = 'published' AND end_time < now() RETURNING 1
    )
    SELECT COUNT(*)::INTEGER INTO p_updated FROM done;
END $$;

-- ============================================================================
-- VIEWS
-- ============================================================================
-- v_event_overview: one row per event with everything the UI needs
CREATE OR REPLACE VIEW v_event_overview AS
SELECT  e.event_id, e.title, e.description, e.start_time, e.end_time,
        e.capacity, e.status, e.cancelled_at,
        c.category_id, c.name AS category_name,
        v.venue_id,    v.name AS venue_name, v.location AS venue_location,
        v.capacity AS venue_capacity,
        u.user_id AS organizer_id, u.full_name AS organizer_name,
        COALESCE(b.confirmed, 0)                    AS confirmed_bookings,
        e.capacity - COALESCE(b.confirmed, 0)       AS seats_remaining,
        COALESCE(att.present, 0)                    AS attended_count,
        fb.avg_rating, COALESCE(fb.rating_count, 0) AS rating_count
FROM events e
JOIN categories c ON c.category_id = e.category_id
JOIN venues     v ON v.venue_id    = e.venue_id
JOIN users      u ON u.user_id     = e.organizer_id
LEFT JOIN (SELECT event_id, COUNT(*) AS confirmed
           FROM bookings WHERE status = 'confirmed' GROUP BY event_id) b ON b.event_id = e.event_id
LEFT JOIN (SELECT bk.event_id, COUNT(*) FILTER (WHERE a.attended) AS present
           FROM attendance a JOIN bookings bk ON bk.booking_id = a.booking_id
           WHERE bk.status = 'confirmed' GROUP BY bk.event_id) att ON att.event_id = e.event_id
LEFT JOIN (SELECT event_id, ROUND(AVG(rating)::NUMERIC, 2) AS avg_rating, COUNT(*) AS rating_count
           FROM feedback GROUP BY event_id) fb ON fb.event_id = e.event_id;

-- v_booking_details: bookings joined with student, event and attendance
CREATE OR REPLACE VIEW v_booking_details AS
SELECT  b.booking_id, b.status AS booking_status, b.booked_at, b.cancelled_at,
        s.user_id AS student_id, s.full_name AS student_name, s.email AS student_email,
        e.event_id, e.title AS event_title, e.start_time, e.end_time,
        e.status AS event_status, e.organizer_id,
        v.name AS venue_name, a.attended, a.marked_at
FROM bookings b
JOIN users  s ON s.user_id  = b.student_id
JOIN events e ON e.event_id = b.event_id
JOIN venues v ON v.venue_id = e.venue_id
LEFT JOIN attendance a ON a.booking_id = b.booking_id;

-- v_category_paths: recursive view -> 'Technical > Artificial Intelligence > Machine Learning'
CREATE OR REPLACE VIEW v_category_paths AS
WITH RECURSIVE tree AS (
    SELECT category_id, name, parent_category_id, 1 AS depth, name::TEXT AS path
    FROM categories WHERE parent_category_id IS NULL
    UNION ALL
    SELECT c.category_id, c.name, c.parent_category_id, t.depth + 1, t.path || ' > ' || c.name
    FROM categories c JOIN tree t ON c.parent_category_id = t.category_id
)
SELECT category_id, name, parent_category_id, depth, path FROM tree;
