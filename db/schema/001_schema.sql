-- =============================================================================
-- College Event Booking & Management System
-- File   : db/schema/001_schema.sql
-- Purpose: Core relational schema (DDL) for PostgreSQL 16
--
-- CREATE DATABASE instructions (run once, as a superuser):
--     CREATE USER ceb_user WITH PASSWORD 'ceb_password';
--     CREATE DATABASE college_events OWNER ceb_user;
--     \c college_events
-- (docker-compose.yml already does this for you.)
--
-- Run order: 001_schema.sql -> 002_advanced.sql -> 003_vector.sql -> seed
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- crypt()/gen_salt() used by the seed data
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- needed for the venue-clash EXCLUDE constraint

-- -----------------------------------------------------------------------------
-- roles : lookup table for RBAC (student / organizer / admin)
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
    role_id     SMALLSERIAL PRIMARY KEY,
    role_name   VARCHAR(20) NOT NULL UNIQUE
                CHECK (role_name IN ('student', 'organizer', 'admin')),
    description TEXT        NOT NULL DEFAULT ''
);

-- -----------------------------------------------------------------------------
-- users : every person who can log in
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    user_id       SERIAL PRIMARY KEY,
    full_name     VARCHAR(100) NOT NULL CHECK (char_length(btrim(full_name)) >= 2),
    email         VARCHAR(255) NOT NULL UNIQUE
                  CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    password_hash TEXT         NOT NULL,                 -- bcrypt hash, never plaintext
    role_id       SMALLINT     NOT NULL
                  REFERENCES roles (role_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    department    VARCHAR(100),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- categories : self-referencing hierarchy (Technical -> Artificial Intelligence
--              -> Machine Learning). Used by the recursive CTE demo.
-- -----------------------------------------------------------------------------
CREATE TABLE categories (
    category_id        SERIAL PRIMARY KEY,
    name               VARCHAR(60) NOT NULL UNIQUE,
    description        TEXT        NOT NULL DEFAULT '',
    parent_category_id INTEGER     REFERENCES categories (category_id) ON DELETE SET NULL,
    CHECK (parent_category_id IS NULL OR parent_category_id <> category_id)
);

-- -----------------------------------------------------------------------------
-- venues
-- -----------------------------------------------------------------------------
CREATE TABLE venues (
    venue_id  SERIAL PRIMARY KEY,
    name      VARCHAR(100) NOT NULL UNIQUE,
    location  VARCHAR(150) NOT NULL DEFAULT '',
    capacity  INTEGER      NOT NULL CHECK (capacity > 0),
    is_active BOOLEAN      NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------------
-- events
-- -----------------------------------------------------------------------------
CREATE TABLE events (
    event_id     SERIAL PRIMARY KEY,
    title        VARCHAR(150) NOT NULL CHECK (char_length(btrim(title)) >= 3),
    description  TEXT         NOT NULL DEFAULT '',
    category_id  INTEGER      NOT NULL REFERENCES categories (category_id) ON DELETE RESTRICT,
    venue_id     INTEGER      NOT NULL REFERENCES venues (venue_id)       ON DELETE RESTRICT,
    organizer_id INTEGER      NOT NULL REFERENCES users (user_id)         ON DELETE RESTRICT,
    start_time   TIMESTAMPTZ  NOT NULL,
    end_time     TIMESTAMPTZ  NOT NULL,
    capacity     INTEGER      NOT NULL CHECK (capacity > 0),
    status       VARCHAR(12)  NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
    cancelled_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (end_time > start_time),
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

-- -----------------------------------------------------------------------------
-- bookings : one row per booking attempt that succeeded. A cancelled booking
--            stays as history; a student may re-book after cancelling.
-- -----------------------------------------------------------------------------
CREATE TABLE bookings (
    booking_id   SERIAL PRIMARY KEY,
    event_id     INTEGER     NOT NULL REFERENCES events (event_id) ON DELETE CASCADE,
    student_id   INTEGER     NOT NULL REFERENCES users (user_id)   ON DELETE RESTRICT,
    status       VARCHAR(10) NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('confirmed', 'cancelled')),
    booked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

-- -----------------------------------------------------------------------------
-- attendance : 1:1 with a (confirmed) booking, written by organizer/admin
-- -----------------------------------------------------------------------------
CREATE TABLE attendance (
    attendance_id SERIAL PRIMARY KEY,
    booking_id    INTEGER     NOT NULL UNIQUE REFERENCES bookings (booking_id) ON DELETE CASCADE,
    attended      BOOLEAN     NOT NULL,
    marked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    marked_by     INTEGER     NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- feedback : one rating per student per event
-- -----------------------------------------------------------------------------
CREATE TABLE feedback (
    feedback_id SERIAL PRIMARY KEY,
    event_id    INTEGER     NOT NULL REFERENCES events (event_id) ON DELETE CASCADE,
    student_id  INTEGER     NOT NULL REFERENCES users (user_id)   ON DELETE CASCADE,
    rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, student_id)
);

-- -----------------------------------------------------------------------------
-- student_interests : many-to-many (students <-> categories). Feeds the
--                     (Student)-[:LIKES]->(Category) edges in Neo4j.
-- -----------------------------------------------------------------------------
CREATE TABLE student_interests (
    student_id  INTEGER     NOT NULL REFERENCES users (user_id)           ON DELETE CASCADE,
    category_id INTEGER     NOT NULL REFERENCES categories (category_id)  ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, category_id)
);

-- =============================================================================
-- ALTER TABLE : extra constraints added after table creation
-- =============================================================================
ALTER TABLE feedback
    ADD CONSTRAINT chk_feedback_comment_length CHECK (char_length(comment) <= 1000);

ALTER TABLE bookings
    ADD CONSTRAINT chk_cancel_after_book CHECK (cancelled_at IS NULL OR cancelled_at >= booked_at);

-- A venue cannot host two published/completed events whose time ranges overlap.
ALTER TABLE events
    ADD CONSTRAINT ex_events_no_venue_overlap
    EXCLUDE USING gist (venue_id WITH =, tstzrange(start_time, end_time) WITH &&)
    WHERE (status IN ('published', 'completed'));

-- =============================================================================
-- INDEXES (why each exists is documented in docs/DATABASE_DESIGN.md)
-- =============================================================================
-- Foreign-key columns (PostgreSQL does NOT index FK columns automatically)
CREATE INDEX idx_users_role        ON users (role_id);
CREATE INDEX idx_categories_parent ON categories (parent_category_id);
CREATE INDEX idx_events_category   ON events (category_id);
CREATE INDEX idx_events_venue      ON events (venue_id);
CREATE INDEX idx_events_organizer  ON events (organizer_id);
CREATE INDEX idx_bookings_event    ON bookings (event_id);
CREATE INDEX idx_bookings_student  ON bookings (student_id);
CREATE INDEX idx_feedback_event    ON feedback (event_id);
CREATE INDEX idx_feedback_student  ON feedback (student_id);
CREATE INDEX idx_interests_category ON student_interests (category_id);

-- Duplicate-booking prevention: at most ONE confirmed booking per student/event.
-- (Partial UNIQUE index - cancelled rows are ignored so re-booking is possible.)
CREATE UNIQUE INDEX uq_active_booking ON bookings (event_id, student_id) WHERE status = 'confirmed';

-- Frequently filtered columns
CREATE INDEX idx_events_status_start ON events (status, start_time);

-- Compound index for the main browse query: category + status + date range
CREATE INDEX idx_events_cat_status_start ON events (category_id, status, start_time);

-- Partial index: the public listing only ever reads published events
CREATE INDEX idx_events_published_start ON events (start_time) WHERE status = 'published';

-- Seat counting: WHERE event_id = ? AND status = 'confirmed'
CREATE INDEX idx_bookings_event_status ON bookings (event_id, status);

-- Keyword search (PostgreSQL full-text search)
CREATE INDEX idx_events_fts ON events
    USING gin (to_tsvector('english', title || ' ' || description));
