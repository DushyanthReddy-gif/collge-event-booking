-- =============================================================================
-- DEMO 01 - DDL (CREATE / ALTER / constraints / index / DROP)
-- Safe: works only on a throw-away table `demo_event_tags`; removed at the end.
-- Run: psql -f db/demo/01_ddl.sql
-- =============================================================================
\echo '--- 1. CREATE TABLE with PK, FK, UNIQUE, NOT NULL, CHECK, DEFAULT'
DROP TABLE IF EXISTS demo_event_tags;
CREATE TABLE demo_event_tags (
    tag_id     SERIAL PRIMARY KEY,                                          -- primary key
    event_id   INTEGER      NOT NULL REFERENCES events (event_id)           -- foreign key
                            ON DELETE CASCADE,                              -- referential action
    tag        VARCHAR(30)  NOT NULL,                                       -- not null
    weight     INTEGER      NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 10), -- default + check
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_event_tag UNIQUE (event_id, tag)                          -- unique
);

\echo '--- 2. ALTER TABLE: add column, add constraint, rename column, change type'
ALTER TABLE demo_event_tags ADD COLUMN is_official BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE demo_event_tags ADD CONSTRAINT chk_tag_lowercase CHECK (tag = lower(tag));
ALTER TABLE demo_event_tags RENAME COLUMN weight TO relevance;
ALTER TABLE demo_event_tags ALTER COLUMN tag TYPE VARCHAR(50);

\echo '--- 3. CREATE INDEX'
CREATE INDEX idx_demo_tags_event ON demo_event_tags (event_id);

\echo '--- 4. Constraints in action (each INSERT below must be rejected)'
INSERT INTO demo_event_tags (event_id, tag) SELECT event_id, 'robotics' FROM events WHERE title = 'Robotics Workshop';
DO $$ BEGIN
  INSERT INTO demo_event_tags (event_id, tag) SELECT event_id, 'robotics' FROM events WHERE title = 'Robotics Workshop';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'UNIQUE blocked duplicate tag'; END $$;
DO $$ BEGIN
  INSERT INTO demo_event_tags (event_id, tag) VALUES (999999, 'ghost');
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'FOREIGN KEY blocked unknown event'; END $$;
DO $$ BEGIN
  INSERT INTO demo_event_tags (event_id, tag, relevance) SELECT event_id, 'x', 99 FROM events LIMIT 1;
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'CHECK blocked relevance = 99'; END $$;
DO $$ BEGIN
  INSERT INTO demo_event_tags (event_id, tag) SELECT event_id, 'UPPER' FROM events LIMIT 1;
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'CHECK blocked upper-case tag'; END $$;

\echo '--- 5. Inspect the structure through the catalog'
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_name = 'demo_event_tags' ORDER BY ordinal_position;
SELECT conname, contype FROM pg_constraint WHERE conrelid = 'demo_event_tags'::regclass ORDER BY conname;

\echo '--- 6. Real schema: constraints and indexes of the events table'
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = 'events'::regclass ORDER BY contype, conname;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'events' ORDER BY indexname;

\echo '--- 7. DROP (cleanup)'
DROP TABLE demo_event_tags;
