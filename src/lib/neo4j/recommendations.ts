import { query } from '@/lib/db/pool';
import { runRead } from './driver';

export interface Recommendation {
  eventId: number;
  title: string;
  categoryName: string;
  startTime: string;
  venueName: string;
  seatsRemaining: number;
  score: number;
  reasons: string[];
  source: 'neo4j' | 'popular';
}

interface GraphHit {
  eventId: number;
  score: number;
  reason: string;
}

// 1. CONTENT-BASED: categories of events the student booked/attended -> other upcoming events there.
const CATEGORY_AFFINITY = `
MATCH (s:Student {userId: $userId})-[:BOOKED|ATTENDED]->(:Event)-[:BELONGS_TO]->(c:Category)
WITH s, c, count(*) AS interactions
MATCH (c)<-[:BELONGS_TO]-(rec:Event {status: 'published'})
WHERE rec.startTime > datetime() AND NOT (s)-[:BOOKED]->(rec)
RETURN rec.eventId AS eventId,
       interactions * 2 AS score,
       'You booked or attended ' + toString(interactions) + ' "' + c.name + '" event(s)' AS reason`;

// 2. EXPLICIT INTERESTS: categories the student marked with LIKES.
const DECLARED_INTERESTS = `
MATCH (s:Student {userId: $userId})-[:LIKES]->(c:Category)
MATCH (c)<-[:BELONGS_TO]-(rec:Event {status: 'published'})
WHERE rec.startTime > datetime() AND NOT (s)-[:BOOKED]->(rec)
RETURN rec.eventId AS eventId, 3 AS score, 'Matches your interest in "' + c.name + '"' AS reason`;

// 3. COLLABORATIVE FILTERING: students who booked the same events also booked these.
const PEERS_ALSO_BOOKED = `
MATCH (s:Student {userId: $userId})-[:BOOKED]->(:Event)<-[:BOOKED]-(peer:Student)-[:BOOKED]->(rec:Event {status: 'published'})
WHERE peer <> s AND rec.startTime > datetime() AND NOT (s)-[:BOOKED]->(rec)
RETURN rec.eventId AS eventId, count(DISTINCT peer) AS score,
       toString(count(DISTINCT peer)) + ' student(s) with similar bookings also booked this' AS reason`;

// 4. SUB-CATEGORY / PARENT-CATEGORY: events in sibling categories (same parent), e.g. AI <-> Robotics under Technical.
const RELATED_CATEGORIES = `
MATCH (s:Student {userId: $userId})-[:BOOKED|ATTENDED]->(:Event)-[:BELONGS_TO]->(:Category)-[:SUBCATEGORY_OF*1..2]->(root:Category)
MATCH (root)<-[:SUBCATEGORY_OF*1..2]-(sibling:Category)<-[:BELONGS_TO]-(rec:Event {status: 'published'})
WHERE rec.startTime > datetime() AND NOT (s)-[:BOOKED]->(rec)
RETURN DISTINCT rec.eventId AS eventId, 1 AS score, 'Related to your interests under "' + root.name + '"' AS reason`;

export async function recommendForStudent(userId: number, limit = 6): Promise<{ items: Recommendation[]; usedGraph: boolean }> {
  const hits: GraphHit[] = [];
  for (const cypher of [CATEGORY_AFFINITY, DECLARED_INTERESTS, PEERS_ALSO_BOOKED, RELATED_CATEGORIES]) {
    hits.push(...(await runRead<GraphHit>(cypher, { userId })));
  }

  // merge: sum the scores of the same event, keep the distinct reasons
  const merged = new Map<number, { score: number; reasons: Set<string> }>();
  for (const h of hits) {
    const m = merged.get(h.eventId) ?? { score: 0, reasons: new Set<string>() };
    m.score += h.score;
    m.reasons.add(h.reason);
    merged.set(h.eventId, m);
  }
  const ranked = [...merged.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit * 2);

  // enrich the graph result with live seat data from PostgreSQL; drop events that are full or gone
  const events = await loadEvents(ranked.map(([id]) => id));
  const items: Recommendation[] = [];
  for (const [id, m] of ranked) {
    const e = events.get(id);
    if (!e || e.seatsRemaining <= 0) continue;
    items.push({ ...e, score: m.score, reasons: [...m.reasons].slice(0, 3), source: 'neo4j' });
    if (items.length >= limit) break;
  }

  // top up with campus-wide popular events so a brand-new student still sees something
  if (items.length < limit) {
    const seen = new Set(items.map((i) => i.eventId));
    const { rows } = await query<{ event_id: number }>(
      `SELECT o.event_id FROM v_event_overview o
       WHERE o.status = 'published' AND o.end_time > now() AND o.seats_remaining > 0
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.event_id = o.event_id AND b.student_id = $1 AND b.status = 'confirmed')
       ORDER BY o.confirmed_bookings DESC, o.start_time LIMIT $2`,
      [userId, limit * 2],
    );
    const extra = await loadEvents(rows.map((r) => r.event_id).filter((id) => !seen.has(id)));
    for (const [, e] of extra) {
      if (items.length >= limit) break;
      items.push({ ...e, score: 0, reasons: ['Popular on campus'], source: 'popular' });
    }
  }
  return { items, usedGraph: hits.length > 0 };
}

/** Used when Neo4j is unreachable: PostgreSQL-only popularity ranking. */
export async function popularFallback(userId: number, limit = 6): Promise<Recommendation[]> {
  const { rows } = await query<{ event_id: number }>(
    `SELECT o.event_id FROM v_event_overview o
     WHERE o.status = 'published' AND o.end_time > now() AND o.seats_remaining > 0
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.event_id = o.event_id AND b.student_id = $1 AND b.status = 'confirmed')
     ORDER BY o.confirmed_bookings DESC, o.start_time LIMIT $2`,
    [userId, limit],
  );
  const events = await loadEvents(rows.map((r) => r.event_id));
  return rows.flatMap((r) => {
    const e = events.get(r.event_id);
    return e ? [{ ...e, score: 0, reasons: ['Popular on campus'], source: 'popular' as const }] : [];
  });
}

async function loadEvents(ids: number[]) {
  const map = new Map<number, Omit<Recommendation, 'score' | 'reasons' | 'source'>>();
  if (ids.length === 0) return map;
  const { rows } = await query<{
    event_id: number; title: string; category_name: string; start_time: Date; venue_name: string; seats_remaining: number;
  }>(
    `SELECT event_id, title, category_name, start_time, venue_name, seats_remaining::int AS seats_remaining
     FROM v_event_overview WHERE event_id = ANY($1::int[]) AND status = 'published' AND end_time > now()`,
    [ids],
  );
  for (const r of rows) {
    map.set(r.event_id, {
      eventId: r.event_id, title: r.title, categoryName: r.category_name, startTime: r.start_time.toISOString(),
      venueName: r.venue_name, seatsRemaining: r.seats_remaining,
    });
  }
  return map;
}
