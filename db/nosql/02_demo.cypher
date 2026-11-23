// =============================================================================
// Neo4j demo - READ, CREATE, UPDATE, DELETE on real graph data
// Prerequisite: `npm run setup` (or `npm run neo4j:setup`) has copied the
// PostgreSQL data into the graph.
// Run: cypher-shell -u neo4j -p <password> -f /db/nosql/02_demo.cypher
// The CREATE/UPDATE/DELETE parts only touch a temporary node (userId 9001),
// which is removed again at the end, so the script is safe to repeat.
// =============================================================================

// ------------------------------- READ ----------------------------------------
// R1. What is in the graph?
MATCH (n) RETURN labels(n)[0] AS label, count(*) AS nodes ORDER BY nodes DESC;

// R2. Relationship counts
MATCH ()-[r]->() RETURN type(r) AS relationship, count(*) AS total ORDER BY total DESC;

// R3. Everything one student is connected to
MATCH (s:Student {name: 'Aarav Sharma'})-[r:BOOKED|ATTENDED|LIKES]->(x)
RETURN type(r) AS relationship, labels(x)[0] AS kind, coalesce(x.title, x.name) AS target
ORDER BY relationship, target;

// R4. Event -> category -> parent category (graph traversal of the hierarchy)
MATCH (e:Event {title: 'Machine Learning Bootcamp'})-[:BELONGS_TO]->(c:Category)-[:SUBCATEGORY_OF*0..]->(ancestor:Category)
RETURN e.title AS event, collect(ancestor.name) AS category_and_ancestors;

// R5. Collaborative filtering: students who booked the same events as Aarav, ranked by overlap
MATCH (me:Student {name: 'Aarav Sharma'})-[:BOOKED]->(e:Event)<-[:BOOKED]-(peer:Student)
WHERE peer <> me
RETURN peer.name AS similar_student, count(e) AS shared_events, collect(e.title) AS shared
ORDER BY shared_events DESC LIMIT 5;

// R6. EVENT RECOMMENDATIONS for Aarav (the same idea the /api/recommendations endpoint uses):
//     upcoming events in categories he has booked / attended, that he has not booked yet
MATCH (s:Student {name: 'Aarav Sharma'})-[:BOOKED|ATTENDED]->(:Event)-[:BELONGS_TO]->(c:Category)
WITH s, c, count(*) AS interactions
MATCH (c)<-[:BELONGS_TO]-(rec:Event {status: 'published'})
WHERE rec.startTime > datetime() AND NOT (s)-[:BOOKED]->(rec)
RETURN rec.title AS recommended_event, c.name AS because_of_category, interactions AS score
ORDER BY score DESC, recommended_event;

// R7. Most popular events (number of BOOKED edges)
MATCH (e:Event)<-[b:BOOKED]-(:Student)
RETURN e.title AS event, count(b) AS bookings ORDER BY bookings DESC LIMIT 5;

// ------------------------------- CREATE --------------------------------------
// C1. A new student node with interests and one booking
MERGE (d:Student {userId: 9001})
  ON CREATE SET d.name = 'Demo Student', d.department = 'Computer Science';
WITH d
MATCH (c:Category {name: 'Robotics'})
MERGE (d)-[:LIKES]->(c);
MATCH (d:Student {userId: 9001}), (e:Event {title: 'Robotics Workshop'})
MERGE (d)-[r:BOOKED]->(e)
  ON CREATE SET r.bookedAt = datetime();

// C2. Check what we created
MATCH (d:Student {userId: 9001})-[r]->(x)
RETURN d.name AS student, type(r) AS relationship, coalesce(x.title, x.name) AS target;

// ------------------------------- UPDATE --------------------------------------
// U1. Update node properties
MATCH (d:Student {userId: 9001})
SET d.name = 'Demo Student (renamed)', d.department = 'Electronics'
RETURN d.userId AS userId, d.name AS name, d.department AS department;

// U2. Update a relationship property
MATCH (:Student {userId: 9001})-[r:BOOKED]->(:Event {title: 'Robotics Workshop'})
SET r.bookedAt = datetime() - duration({days: 1}), r.note = 'rescheduled in demo'
RETURN r.bookedAt AS bookedAt, r.note AS note;

// U3. Change an interest: remove one LIKES edge and add another
MATCH (:Student {userId: 9001})-[l:LIKES]->(:Category {name: 'Robotics'}) DELETE l;
MATCH (d:Student {userId: 9001}), (c:Category {name: 'Music'}) MERGE (d)-[:LIKES]->(c);
MATCH (:Student {userId: 9001})-[:LIKES]->(c) RETURN c.name AS interests;

// ------------------------------- DELETE --------------------------------------
// D1. Delete one relationship (equivalent of cancelling a booking)
MATCH (:Student {userId: 9001})-[r:BOOKED]->(:Event {title: 'Robotics Workshop'}) DELETE r;

// D2. Delete the node together with all of its remaining relationships
MATCH (d:Student {userId: 9001}) DETACH DELETE d;

// D3. Prove it is gone (expect 0)
MATCH (d:Student {userId: 9001}) RETURN count(d) AS remaining_demo_nodes;
