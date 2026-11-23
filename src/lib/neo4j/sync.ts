/**
 * PostgreSQL -> Neo4j projection.
 *
 * PostgreSQL is the source of truth. After a successful SQL transaction the API calls one of the
 * sync* functions below (through safeSync, which never throws), so a Neo4j outage can not break
 * bookings. `npm run neo4j:setup` rebuilds the whole graph with fullSync().
 */
import { query } from '@/lib/db/pool';
import { runWrite } from './driver';

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/** Runs a sync step, logging (not throwing) on failure. Returns true when the graph was updated. */
export async function safeSync(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(`[neo4j] sync "${label}" skipped:`, (err as Error).message);
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
// Reference data: categories (+ hierarchy) and venues
// ----------------------------------------------------------------------------------------------
export async function syncMeta(): Promise<void> {
  const cats = await query<{ category_id: number; name: string; parent_category_id: number | null }>(
    'SELECT category_id, name, parent_category_id FROM categories',
  );
  const venues = await query<{ venue_id: number; name: string; capacity: number }>('SELECT venue_id, name, capacity FROM venues');

  await runWrite(
    `UNWIND $rows AS r
     MERGE (c:Category {categoryId: r.categoryId})
     SET c.name = r.name`,
    { rows: cats.rows.map((c) => ({ categoryId: c.category_id, name: c.name })) },
  );
  // rebuild the hierarchy edges (a category may have been re-parented)
  await runWrite('MATCH (:Category)-[r:SUBCATEGORY_OF]->(:Category) DELETE r');
  await runWrite(
    `UNWIND $rows AS r
     MATCH (c:Category {categoryId: r.categoryId}), (p:Category {categoryId: r.parentId})
     MERGE (c)-[:SUBCATEGORY_OF]->(p)`,
    { rows: cats.rows.filter((c) => c.parent_category_id !== null).map((c) => ({ categoryId: c.category_id, parentId: c.parent_category_id })) },
  );
  await runWrite(
    `UNWIND $rows AS r
     MERGE (v:Venue {venueId: r.venueId})
     SET v.name = r.name, v.capacity = r.capacity`,
    { rows: venues.rows.map((v) => ({ venueId: v.venue_id, name: v.name, capacity: v.capacity })) },
  );
}

// ----------------------------------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------------------------------
export async function syncUsers(userIds?: number[]): Promise<void> {
  const { rows } = await query<{ user_id: number; full_name: string; department: string | null; role_name: string }>(
    `SELECT u.user_id, u.full_name, u.department, r.role_name
     FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE u.is_active AND ($1::int[] IS NULL OR u.user_id = ANY($1::int[]))`,
    [userIds ?? null],
  );
  const toRow = (u: (typeof rows)[number]) => ({ userId: u.user_id, name: u.full_name, department: u.department ?? '' });
  await runWrite(
    `UNWIND $rows AS r
     MERGE (s:Student {userId: r.userId})
     SET s.name = r.name, s.department = r.department`,
    { rows: rows.filter((u) => u.role_name === 'student').map(toRow) },
  );
  await runWrite(
    `UNWIND $rows AS r
     MERGE (o:Organizer {userId: r.userId})
     SET o.name = r.name, o.department = r.department`,
    { rows: rows.filter((u) => u.role_name !== 'student').map(toRow) },
  );
}

// ----------------------------------------------------------------------------------------------
// Events (node + BELONGS_TO / HELD_AT / ORGANIZES edges)
// ----------------------------------------------------------------------------------------------
export async function syncEvents(eventIds?: number[]): Promise<void> {
  const { rows } = await query<{
    event_id: number; title: string; status: string; start_time: Date; capacity: number;
    category_id: number; category_name: string; venue_id: number; venue_name: string;
    venue_capacity: number; organizer_id: number; organizer_name: string;
  }>(
    `SELECT event_id, title, status, start_time, capacity, category_id, category_name,
            venue_id, venue_name, venue_capacity, organizer_id, organizer_name
     FROM v_event_overview WHERE ($1::int[] IS NULL OR event_id = ANY($1::int[]))`,
    [eventIds ?? null],
  );
  if (rows.length === 0) return;
  const data = rows.map((e) => ({
    eventId: e.event_id, title: e.title, status: e.status, startTime: iso(e.start_time), capacity: e.capacity,
    categoryId: e.category_id, categoryName: e.category_name, venueId: e.venue_id, venueName: e.venue_name,
    venueCapacity: e.venue_capacity, organizerId: e.organizer_id, organizerName: e.organizer_name,
  }));

  // drop old structural edges first so a changed category/venue/organizer does not leave stale edges
  await runWrite(
    `MATCH (e:Event)-[old:BELONGS_TO|HELD_AT|ORGANIZES]-()
     WHERE e.eventId IN $ids DELETE old`,
    { ids: data.map((d) => d.eventId) },
  );
  await runWrite(
    `UNWIND $rows AS r
     MERGE (e:Event {eventId: r.eventId})
     SET e.title = r.title, e.status = r.status, e.startTime = datetime(r.startTime), e.capacity = r.capacity
     MERGE (c:Category {categoryId: r.categoryId}) ON CREATE SET c.name = r.categoryName
     MERGE (v:Venue {venueId: r.venueId})          ON CREATE SET v.name = r.venueName, v.capacity = r.venueCapacity
     MERGE (o:Organizer {userId: r.organizerId})   ON CREATE SET o.name = r.organizerName
     MERGE (e)-[:BELONGS_TO]->(c)
     MERGE (e)-[:HELD_AT]->(v)
     MERGE (o)-[:ORGANIZES]->(e)`,
    { rows: data },
  );
}

// ----------------------------------------------------------------------------------------------
// Student <-> Event edges (BOOKED, ATTENDED). Re-derived from PostgreSQL for the given scope,
// so a cancellation simply makes the BOOKED edge disappear.
// ----------------------------------------------------------------------------------------------
export async function syncStudentEventLinks(scope: { eventIds?: number[]; studentIds?: number[] } = {}): Promise<void> {
  const eventIds = scope.eventIds ?? null;
  const studentIds = scope.studentIds ?? null;
  const { rows } = await query<{
    booking_id: number; event_id: number; student_id: number; student_name: string;
    booked_at: Date; attended: boolean | null; marked_at: Date | null;
  }>(
    `SELECT b.booking_id, b.event_id, b.student_id, s.full_name AS student_name, b.booked_at, a.attended, a.marked_at
     FROM bookings b
     JOIN users s ON s.user_id = b.student_id
     LEFT JOIN attendance a ON a.booking_id = b.booking_id
     WHERE b.status = 'confirmed'
       AND ($1::int[] IS NULL OR b.event_id   = ANY($1::int[]))
       AND ($2::int[] IS NULL OR b.student_id = ANY($2::int[]))`,
    [eventIds, studentIds],
  );

  await runWrite(
    `MATCH (s:Student)-[r:BOOKED|ATTENDED]->(e:Event)
     WHERE ($eventIds IS NULL OR e.eventId IN $eventIds) AND ($studentIds IS NULL OR s.userId IN $studentIds)
     DELETE r`,
    { eventIds, studentIds },
  );
  const booked = rows.map((r) => ({ studentId: r.student_id, name: r.student_name, eventId: r.event_id, at: iso(r.booked_at) }));
  const attended = rows
    .filter((r) => r.attended && r.marked_at)
    .map((r) => ({ studentId: r.student_id, name: r.student_name, eventId: r.event_id, at: iso(r.marked_at as Date) }));

  await runWrite(
    `UNWIND $rows AS r
     MERGE (s:Student {userId: r.studentId}) ON CREATE SET s.name = r.name
     WITH r, s
     MATCH (e:Event {eventId: r.eventId})
     MERGE (s)-[b:BOOKED]->(e) SET b.bookedAt = datetime(r.at)`,
    { rows: booked },
  );
  await runWrite(
    `UNWIND $rows AS r
     MERGE (s:Student {userId: r.studentId}) ON CREATE SET s.name = r.name
     WITH r, s
     MATCH (e:Event {eventId: r.eventId})
     MERGE (s)-[a:ATTENDED]->(e) SET a.markedAt = datetime(r.at)`,
    { rows: attended },
  );
}

// ----------------------------------------------------------------------------------------------
// Student interests -> (Student)-[:LIKES]->(Category)
// ----------------------------------------------------------------------------------------------
export async function syncInterests(studentIds?: number[]): Promise<void> {
  const ids = studentIds ?? null;
  const { rows } = await query<{ student_id: number; category_id: number }>(
    'SELECT student_id, category_id FROM student_interests WHERE ($1::int[] IS NULL OR student_id = ANY($1::int[]))',
    [ids],
  );
  await runWrite(
    `MATCH (s:Student)-[l:LIKES]->(:Category) WHERE $ids IS NULL OR s.userId IN $ids DELETE l`,
    { ids },
  );
  await runWrite(
    `UNWIND $rows AS r
     MATCH (s:Student {userId: r.studentId}), (c:Category {categoryId: r.categoryId})
     MERGE (s)-[:LIKES]->(c)`,
    { rows: rows.map((r) => ({ studentId: r.student_id, categoryId: r.category_id })) },
  );
}

// ----------------------------------------------------------------------------------------------
// Convenience bundles used by the API layer
// ----------------------------------------------------------------------------------------------
export async function syncEventAndLinks(eventId: number): Promise<void> {
  await syncEvents([eventId]);
  await syncStudentEventLinks({ eventIds: [eventId] });
}

export async function syncBookingChange(eventId: number, studentId: number): Promise<void> {
  await syncUsers([studentId]);
  await syncEvents([eventId]);
  await syncStudentEventLinks({ eventIds: [eventId], studentIds: [studentId] });
}

/** Wipes the graph and rebuilds it completely from PostgreSQL. */
export async function fullSync(): Promise<{ nodes: number; relationships: number }> {
  await runWrite('MATCH (n) DETACH DELETE n');
  await syncMeta();
  await syncUsers();
  await syncEvents();
  await syncStudentEventLinks();
  await syncInterests();
  const { runRead } = await import('./driver');
  const [n] = await runRead<{ c: number }>('MATCH (n) RETURN count(n) AS c');
  const [r] = await runRead<{ c: number }>('MATCH ()-[r]->() RETURN count(r) AS c');
  return { nodes: n?.c ?? 0, relationships: r?.c ?? 0 };
}
