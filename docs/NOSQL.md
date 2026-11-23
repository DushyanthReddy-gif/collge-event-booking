# NoSQL: Neo4j graph database

## Why Neo4j
The recommendation feature asks questions such as *"which upcoming events are in the categories of events this student booked or attended,
or were booked by students who share bookings with this student?"* In SQL this is several self-joins over `bookings`, `events` and `categories`
whose cost grows with every extra hop. In a graph database the relationships are stored as first-class edges, so each hop is a pointer walk and the
query reads like the sentence above. Neo4j is therefore used **only** for relationship-heavy reads; it does not replace PostgreSQL.

## Responsibility split
* **PostgreSQL** = source of truth (transactions, constraints, seats, authentication).
* **Neo4j** = a *projection* of that data for graph queries. After each successful SQL transaction the API calls `src/lib/neo4j/sync.ts` (`safeSync`).
  A Neo4j outage never breaks booking: the error is logged, a 30-second circuit breaker avoids slow retries, and `GET /api/recommendations`
  falls back to a PostgreSQL popularity list (`"source": "postgres-fallback"`).
* `npm run neo4j:setup` wipes and rebuilds the whole graph from PostgreSQL (`fullSync()`), so the two can never stay permanently inconsistent.

## Graph model (`db/nosql/01_schema.cypher`)

```text
(:Student {userId, name, department})
(:Organizer {userId, name, department})
(:Event {eventId, title, status, startTime, capacity})
(:Category {categoryId, name})
(:Venue {venueId, name, capacity})

(Student)-[:BOOKED {bookedAt}]->(Event)      confirmed bookings only (removed on cancellation)
(Student)-[:ATTENDED {markedAt}]->(Event)    attendance = present
(Student)-[:LIKES]->(Category)               rows of student_interests
(Event)-[:BELONGS_TO]->(Category)
(Event)-[:HELD_AT]->(Venue)
(Organizer)-[:ORGANIZES]->(Event)
(Category)-[:SUBCATEGORY_OF]->(Category)     the category hierarchy
```

Constraints: unique `Student.userId`, `Organizer.userId`, `Event.eventId`, `Category.categoryId`, `Venue.venueId`.
Indexes: `Event.startTime`, `Event.status`, `Category.name`.

## Recommendation feature (`src/lib/neo4j/recommendations.ts`)
`GET /api/recommendations` (students only) runs four Cypher queries and merges the scores:

| # | Strategy | Cypher idea | Score |
|---|---|---|---|
| 1 | content-based | `(s)-[:BOOKED\|ATTENDED]->(:Event)-[:BELONGS_TO]->(c)<-[:BELONGS_TO]-(rec)` | 2 x number of interactions with that category |
| 2 | declared interests | `(s)-[:LIKES]->(c)<-[:BELONGS_TO]-(rec)` | 3 |
| 3 | collaborative filtering | `(s)-[:BOOKED]->(:Event)<-[:BOOKED]-(peer)-[:BOOKED]->(rec)` | number of distinct peers |
| 4 | sibling categories | walk `SUBCATEGORY_OF*1..2` up and down the hierarchy | 1 |

All four exclude events the student already booked, only return `published` upcoming events, and the merged list is enriched with live seat counts from
PostgreSQL (full events are dropped). Every result carries human-readable *reasons* ("You booked or attended 2 'Robotics' event(s)"), shown on the dashboard.

## CRUD / RUD demonstration (`db/nosql/02_demo.cypher`)
Run: `docker compose exec -T neo4j cypher-shell -u neo4j -p ceb_neo4j_password -f /db/nosql/02_demo.cypher`

| Part | Statements |
|---|---|
| **READ** R1-R7 | counts per label/relationship, everything connected to one student, event -> category -> ancestors (`SUBCATEGORY_OF*0..`), collaborative-filtering peers, recommendation query, most popular events |
| **CREATE** C1-C2 | `MERGE (d:Student {userId: 9001})`, `LIKES`, `BOOKED` edges |
| **UPDATE** U1-U3 | `SET` node properties, `SET` relationship properties, replace a `LIKES` edge |
| **DELETE** D1-D3 | `DELETE r` (a relationship), `DETACH DELETE` (node + edges), verification query (0 rows) |

Create/Update/Delete only touch the temporary node `userId: 9001`, so the script is repeatable.

## How to look at it
Open <http://localhost:7474> (user `neo4j`, password from `.env`) and run
`MATCH p=(s:Student {name:'Aarav Sharma'})-[:BOOKED|ATTENDED|LIKES]->() RETURN p` to see the graph visually.

## Honest limitations
* The graph is eventually consistent with PostgreSQL (a sync can be skipped while Neo4j is down; `npm run neo4j:setup` repairs it).
* Role changes in the admin panel add the user to the correct label but do not remove the old label node; rebuild with `npm run neo4j:setup` if needed.
