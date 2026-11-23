import type { SessionUser } from '@/lib/auth/session';
import { query } from '@/lib/db/pool';
import { EVENT_COLUMNS, assertCanManage, type EventSummary } from './service';

export async function getEventStats(user: SessionUser, eventId: number) {
  await assertCanManage(user, eventId);
  const [overview, perDay, ratings, rates] = await Promise.all([
    query<EventSummary>(`SELECT ${EVENT_COLUMNS} FROM v_event_overview o WHERE o.event_id = $1`, [eventId]),
    query<{ day: string; confirmed: number; cancelled: number }>(
      `SELECT to_char(date_trunc('day', booked_at), 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
       FROM bookings WHERE event_id = $1 GROUP BY 1 ORDER BY 1`,
      [eventId],
    ),
    query<{ rating: number; count: number }>('SELECT rating, COUNT(*)::int AS count FROM feedback WHERE event_id = $1 GROUP BY rating ORDER BY rating', [eventId]),
    query<{ attendance_pct: number; cancelled: number }>(
      `SELECT attendance_rate($1)::float AS attendance_pct,
              (SELECT COUNT(*)::int FROM bookings WHERE event_id = $1 AND status = 'cancelled') AS cancelled`,
      [eventId],
    ),
  ]);
  const o = overview.rows[0];
  return {
    event: o,
    fillPercent: o ? Math.round((100 * o.confirmedBookings) / o.capacity) : 0,
    attendancePercent: rates.rows[0].attendance_pct,
    cancelledBookings: rates.rows[0].cancelled,
    bookingsPerDay: perDay.rows,
    ratingDistribution: ratings.rows,
  };
}

/** Dashboard numbers for one organizer (own events only). */
export async function getOrganizerStats(user: SessionUser) {
  const { rows } = await query<{
    eventId: number; title: string; status: string; startTime: string; capacity: number;
    confirmedBookings: number; attendedCount: number; attendancePct: number; avgRating: number | null; ratingCount: number;
  }>(
    `SELECT o.event_id AS "eventId", o.title, o.status, o.start_time AS "startTime", o.capacity,
            o.confirmed_bookings::int AS "confirmedBookings", o.attended_count::int AS "attendedCount",
            attendance_rate(o.event_id)::float AS "attendancePct", o.avg_rating::float AS "avgRating",
            o.rating_count::int AS "ratingCount"
     FROM v_event_overview o WHERE o.organizer_id = $1 ORDER BY o.start_time DESC`,
    [user.userId],
  );
  const live = rows.filter((r) => r.status === 'published' || r.status === 'completed');
  const rated = rows.filter((r) => r.avgRating !== null);
  return {
    totals: {
      events: rows.length,
      published: rows.filter((r) => r.status === 'published').length,
      drafts: rows.filter((r) => r.status === 'draft').length,
      confirmedBookings: live.reduce((s, r) => s + r.confirmedBookings, 0),
      averageRating: rated.length ? Math.round((100 * rated.reduce((s, r) => s + (r.avgRating as number), 0)) / rated.length) / 100 : null,
    },
    events: rows,
  };
}
