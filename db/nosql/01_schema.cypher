// =============================================================================
// Neo4j graph schema - College Event Booking & Management System
// Run: cypher-shell -u neo4j -p <password> -f /db/nosql/01_schema.cypher
// (also executed by `npm run neo4j:setup`)
//
// PostgreSQL stays the source of truth. The graph is a projection of it that is
// kept in sync by src/lib/neo4j/sync.ts and used for relationship-heavy queries.
//
// NODE LABELS                    KEY PROPERTIES
//   (:Student)                   userId*, name, department
//   (:Organizer)                 userId*, name, department
//   (:Event)                     eventId*, title, status, startTime, capacity
//   (:Category)                  categoryId*, name
//   (:Venue)                     venueId*, name, capacity
//
// RELATIONSHIPS
//   (Student)-[:BOOKED   {bookedAt}]->(Event)     confirmed booking
//   (Student)-[:ATTENDED {markedAt}]->(Event)     attendance = present
//   (Student)-[:LIKES]->(Category)                declared interests
//   (Event)-[:BELONGS_TO]->(Category)
//   (Event)-[:HELD_AT]->(Venue)
//   (Organizer)-[:ORGANIZES]->(Event)
//   (Category)-[:SUBCATEGORY_OF]->(Category)      category hierarchy
// =============================================================================

// ---- uniqueness constraints (also create backing indexes) --------------------
CREATE CONSTRAINT student_user_id   IF NOT EXISTS FOR (s:Student)   REQUIRE s.userId     IS UNIQUE;
CREATE CONSTRAINT organizer_user_id IF NOT EXISTS FOR (o:Organizer) REQUIRE o.userId     IS UNIQUE;
CREATE CONSTRAINT event_event_id    IF NOT EXISTS FOR (e:Event)     REQUIRE e.eventId    IS UNIQUE;
CREATE CONSTRAINT category_id       IF NOT EXISTS FOR (c:Category)  REQUIRE c.categoryId IS UNIQUE;
CREATE CONSTRAINT venue_id          IF NOT EXISTS FOR (v:Venue)     REQUIRE v.venueId    IS UNIQUE;

// ---- property existence is an Enterprise feature, so we index what we filter on ----
CREATE INDEX event_start_time  IF NOT EXISTS FOR (e:Event)    ON (e.startTime);
CREATE INDEX event_status      IF NOT EXISTS FOR (e:Event)    ON (e.status);
CREATE INDEX category_name_idx IF NOT EXISTS FOR (c:Category) ON (c.name);
