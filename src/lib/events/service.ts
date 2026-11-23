import { query } from '@/lib/db/pool';
import { ApiError } from '@/lib/db/errors';
import type { SessionUser } from '@/lib/auth/session';
import type { EventCreateInput, EventFilters, EventUpdateInput } from '@/schemas';
import { safeRefreshEmbedding } from '@/lib/embeddings/events';
import { safeSync, syncEventAndLinks, syncStudentEventLinks } from '@/lib/neo4j/sync';

/** Column list over the v_event_overview view, aliased to camelCase for the JSON API. */
export const EVENT_COLUMNS = `
  o.event_id AS "eventId", o.title, o.description,
  o.start_time AS "startTime", o.end_time AS "endTime", o.capacity, o.status,
  o.cancelled_at AS "cancelledAt",
  o.category_id AS "categoryId", o.category_name AS "categoryName",
  o.venue_id AS "venueId", o.venue_name AS "venueName", o.venue_location AS "venueLocation",
  o.organizer_id AS "organizerId", o.organizer_name AS "organizerName",
  o.confirmed_bookings::int AS "confirmedBookings", o.seats_remaining::int AS "seatsRemaining",
  o.attended_count::int AS "attendedCount", o.avg_rating::float AS "avgRating", o.rating_count::int AS "ratingCount"`;

export interface EventSummary {
  eventId: number;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  capacity: number;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  cancelledAt: string | null;
  categoryId: number;
  categoryName: string;
  venueId: number;
  venueName: string;
  venueLocation: string;
  organizerId: number;
  organizerName: string;
  confirmedBookings: number;
  seatsRemaining: number;
  attendedCount: number;
  avgRating: number | null;
  ratingCount: number;
  score?: number | null;
  similarity?: number | null;
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Which public events does a time filter select? Parameter-free SQL fragments. */
export function whenClause(when: EventFilters['when']): string {
  switch (when) {
    case 'upcoming':
      return `(o.status = 'published' AND o.end_time > now())`;
    case 'past':
      return `(o.status IN ('published', 'completed') AND o.end_time <= now())`;
    default:
      return `(o.status IN ('published', 'completed'))`;
  }
}

export async function listEvents(user: SessionUser | null, f: EventFilters): Promise<EventSummary[]> {
  const params: unknown[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = [];

  if (f.scope === 'manage') {
    // management view: organizers see only their own events, admins see everything
    if (!user || user.role === 'student') throw new ApiError(user ? 403 : 401, user ? 'Not allowed' : 'Please log in');
    if (user.role === 'organizer') where.push(`o.organizer_id = ${add(user.userId)}`);
  } else {
    where.push(whenClause(f.when));
  }
  if (f.categoryId) where.push(`o.category_id = ${add(f.categoryId)}`);
  if (f.venueId) where.push(`o.venue_id = ${add(f.venueId)}`);

  let scoreSql = 'NULL::float AS score';
  let orderSql = f.when === 'past' || f.scope === 'manage' ? 'o.start_time DESC' : 'o.start_time ASC';
  if (f.q) {
    const q = add(f.q);
    const like = add(`%${escapeLike(f.q)}%`);
    const tsv = `to_tsvector('english', o.title || ' ' || o.description)`;
    where.push(`(${tsv} @@ websearch_to_tsquery('english', ${q}) OR o.title ILIKE ${like} OR o.category_name ILIKE ${like})`);
    scoreSql = `(ts_rank(${tsv}, websearch_to_tsquery('english', ${q})) + CASE WHEN o.title ILIKE ${like} THEN 1 ELSE 0 END)::float AS score`;
    orderSql = `score DESC, o.start_time ASC`;
  }

  const limit = add(f.limit);
  const offset = add(f.offset);
  const sql = `SELECT ${EVENT_COLUMNS}, ${scoreSql}
               FROM v_event_overview o
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY ${orderSql}
               LIMIT ${limit} OFFSET ${offset}`;
  const { rows } = await query<EventSummary>(sql, params);
  return rows;
}

export interface EventDetail extends EventSummary {
  viewer: {
    booking: { bookingId: number; status: string } | null;
    attended: boolean;
    feedback: { rating: number; comment: string } | null;
    canManage: boolean;
  };
}

export async function getEventDetail(user: SessionUser | null, eventId: number): Promise<EventDetail> {
  const { rows } = await query<EventSummary>(`SELECT ${EVENT_COLUMNS}, NULL::float AS score FROM v_event_overview o WHERE o.event_id = $1`, [eventId]);
  const ev = rows[0];
  const canManage = !!user && (user.role === 'admin' || (user.role === 'organizer' && user.userId === ev?.organizerId));
  // drafts are invisible to everyone except the organizer / admin: answer 404, not 403
  if (!ev || (ev.status === 'draft' && !canManage)) throw new ApiError(404, 'Event not found');

  const viewer: EventDetail['viewer'] = { booking: null, attended: false, feedback: null, canManage };
  if (user?.role === 'student') {
    const b = await query<{ booking_id: number; status: string; attended: boolean | null }>(
      `SELECT b.booking_id, b.status, a.attended
       FROM bookings b LEFT JOIN attendance a ON a.booking_id = b.booking_id
       WHERE b.event_id = $1 AND b.student_id = $2
       ORDER BY (b.status = 'confirmed') DESC, b.booked_at DESC LIMIT 1`,
      [eventId, user.userId],
    );
    if (b.rows[0]) {
      viewer.booking = { bookingId: b.rows[0].booking_id, status: b.rows[0].status };
      viewer.attended = b.rows[0].status === 'confirmed' && b.rows[0].attended === true;
    }
    const f = await query<{ rating: number; comment: string }>('SELECT rating, comment FROM feedback WHERE event_id = $1 AND student_id = $2', [eventId, user.userId]);
    viewer.feedback = f.rows[0] ?? null;
  }
  return { ...ev, viewer };
}

/** 404 if the event does not exist, 403 unless the caller is the event's organizer or an admin. */
export async function assertCanManage(user: SessionUser, eventId: number) {
  if (user.role !== 'organizer' && user.role !== 'admin') throw new ApiError(403, 'Only organizers and admins can manage events');
  const { rows } = await query<{ event_id: number; organizer_id: number; status: string; start_time: Date; end_time: Date }>(
    'SELECT event_id, organizer_id, status, start_time, end_time FROM events WHERE event_id = $1',
    [eventId],
  );
  const ev = rows[0];
  if (!ev) throw new ApiError(404, 'Event not found');
  if (user.role !== 'admin' && ev.organizer_id !== user.userId) throw new ApiError(403, 'You can only manage your own events');
  return ev;
}

export async function createEvent(user: SessionUser, input: EventCreateInput): Promise<number> {
  const { rows } = await query<{ event_id: number }>(
    `INSERT INTO events (title, description, category_id, venue_id, organizer_id, start_time, end_time, capacity, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING event_id`,
    [input.title, input.description, input.categoryId, input.venueId, user.userId, input.startTime, input.endTime, input.capacity, input.status],
  );
  const id = rows[0].event_id;
  await Promise.all([safeRefreshEmbedding(id), safeSync('event created', () => syncEventAndLinks(id))]);
  return id;
}

const UPDATABLE: Record<keyof EventUpdateInput, string> = {
  title: 'title',
  description: 'description',
  categoryId: 'category_id',
  venueId: 'venue_id',
  startTime: 'start_time',
  endTime: 'end_time',
  capacity: 'capacity',
};

export async function updateEvent(user: SessionUser, eventId: number, patch: EventUpdateInput): Promise<void> {
  const ev = await assertCanManage(user, eventId);
  if (ev.status === 'cancelled' || ev.status === 'completed') {
    throw new ApiError(409, `A ${ev.status} event can no longer be edited`);
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    const value = patch[key as keyof EventUpdateInput];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  params.push(eventId);
  await query(`UPDATE events SET ${sets.join(', ')} WHERE event_id = $${params.length}`, params);
  await Promise.all([safeRefreshEmbedding(eventId), safeSync('event updated', () => syncEventAndLinks(eventId))]);
}

export async function deleteEvent(user: SessionUser, eventId: number): Promise<void> {
  const ev = await assertCanManage(user, eventId);
  if (ev.status !== 'draft') throw new ApiError(409, 'Only draft events can be deleted. Cancel a published event instead.');
  await query('DELETE FROM events WHERE event_id = $1', [eventId]);
  await safeSync('event deleted', async () => {
    const { runWrite } = await import('@/lib/neo4j/driver');
    await runWrite('MATCH (e:Event {eventId: $id}) DETACH DELETE e', { id: eventId });
  });
}

export async function publishEvent(user: SessionUser, eventId: number): Promise<void> {
  const ev = await assertCanManage(user, eventId);
  if (ev.status !== 'draft') throw new ApiError(409, 'Only draft events can be published');
  if (ev.end_time <= new Date()) throw new ApiError(409, 'This event has already ended and cannot be published');
  await query(`UPDATE events SET status = 'published' WHERE event_id = $1`, [eventId]);
  await safeSync('event published', () => syncEventAndLinks(eventId));
}

/** Cancels via the stored procedure cancel_event(): event + all confirmed bookings in one atomic step. */
export async function cancelEvent(user: SessionUser, eventId: number): Promise<{ cancelledBookings: number }> {
  await assertCanManage(user, eventId);
  const { rows } = await query<{ p_cancelled_bookings: number }>('CALL cancel_event($1::int, $2::int, 0)', [eventId, user.userId]);
  await safeSync('event cancelled', async () => {
    await syncEventAndLinks(eventId);
    await syncStudentEventLinks({ eventIds: [eventId] });
  });
  return { cancelledBookings: rows[0]?.p_cancelled_bookings ?? 0 };
}
