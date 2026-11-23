import type { SessionUser } from '@/lib/auth/session';
import { query, withTransaction } from '@/lib/db/pool';
import { ApiError } from '@/lib/db/errors';
import { safeSync, syncBookingChange } from '@/lib/neo4j/sync';

/**
 * Concurrency-safe booking.
 *
 *   BEGIN;
 *   SELECT ... FROM events WHERE event_id = $1 FOR UPDATE;   -- row lock: bookings for the SAME event queue here
 *   -- check status / duplicate / free seats WHILE holding the lock
 *   INSERT INTO bookings ...;
 *   COMMIT;                                                  -- lock released, next request sees the new count
 *
 * If this code were bypassed, the prevent_overbooking trigger (db/schema/002_advanced.sql) takes the same
 * lock and re-checks the capacity, so the database itself still refuses an overbooking.
 */
export async function bookSeat(user: SessionUser, eventId: number): Promise<{ bookingId: number }> {
  const bookingId = await withTransaction(async (client) => {
    const ev = await client.query<{ capacity: number; status: string; end_time: Date }>(
      'SELECT capacity, status, end_time FROM events WHERE event_id = $1 FOR UPDATE',
      [eventId],
    );
    if (ev.rowCount === 0) throw new ApiError(404, 'Event not found');
    const { capacity, status, end_time } = ev.rows[0];
    if (status !== 'published' || end_time <= new Date()) throw new ApiError(409, 'This event is not open for booking');

    const dup = await client.query(
      `SELECT 1 FROM bookings WHERE event_id = $1 AND student_id = $2 AND status = 'confirmed'`,
      [eventId, user.userId],
    );
    if (dup.rowCount) throw new ApiError(409, 'You already have a confirmed booking for this event');

    const taken = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM bookings WHERE event_id = $1 AND status = 'confirmed'`,
      [eventId],
    );
    if (taken.rows[0].n >= capacity) throw new ApiError(409, 'Sorry, this event is fully booked');

    const ins = await client.query<{ booking_id: number }>(
      'INSERT INTO bookings (event_id, student_id) VALUES ($1, $2) RETURNING booking_id',
      [eventId, user.userId],
    );
    return ins.rows[0].booking_id;
  });
  await safeSync('booking created', () => syncBookingChange(eventId, user.userId));
  return { bookingId };
}

export async function cancelBooking(user: SessionUser, eventId: number): Promise<{ bookingId: number }> {
  const bookingId = await withTransaction(async (client) => {
    const found = await client.query<{ booking_id: number; start_time: Date }>(
      `SELECT b.booking_id, e.start_time
       FROM bookings b JOIN events e ON e.event_id = b.event_id
       WHERE b.event_id = $1 AND b.student_id = $2 AND b.status = 'confirmed'
       FOR UPDATE OF b`,
      [eventId, user.userId], // student_id = caller: nobody can cancel somebody else's booking
    );
    if (found.rowCount === 0) throw new ApiError(404, 'You have no confirmed booking for this event');
    if (found.rows[0].start_time <= new Date()) throw new ApiError(409, 'This event has already started; the booking can no longer be cancelled');
    await client.query(`UPDATE bookings SET status = 'cancelled' WHERE booking_id = $1`, [found.rows[0].booking_id]);
    return found.rows[0].booking_id;
  });
  await safeSync('booking cancelled', () => syncBookingChange(eventId, user.userId));
  return { bookingId };
}

export interface BookingRow {
  bookingId: number;
  bookingStatus: 'confirmed' | 'cancelled';
  bookedAt: string;
  cancelledAt: string | null;
  studentId: number;
  studentName: string;
  studentEmail: string;
  eventId: number;
  eventTitle: string;
  startTime: string;
  endTime: string;
  eventStatus: string;
  venueName: string;
  attended: boolean | null;
  hasFeedback: boolean;
}

/** Students see their own bookings, organizers see bookings of their events, admins see all. */
export async function listBookings(user: SessionUser, opts: { eventId?: number } = {}): Promise<BookingRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (user.role === 'student') {
    params.push(user.userId);
    where.push(`d.student_id = $${params.length}`);
  } else if (user.role === 'organizer') {
    params.push(user.userId);
    where.push(`d.organizer_id = $${params.length}`);
  }
  if (opts.eventId) {
    params.push(opts.eventId);
    where.push(`d.event_id = $${params.length}`);
  }
  const { rows } = await query<BookingRow>(
    `SELECT d.booking_id AS "bookingId", d.booking_status AS "bookingStatus", d.booked_at AS "bookedAt",
            d.cancelled_at AS "cancelledAt", d.student_id AS "studentId", d.student_name AS "studentName",
            d.student_email AS "studentEmail", d.event_id AS "eventId", d.event_title AS "eventTitle",
            d.start_time AS "startTime", d.end_time AS "endTime", d.event_status AS "eventStatus",
            d.venue_name AS "venueName", d.attended,
            EXISTS (SELECT 1 FROM feedback f WHERE f.event_id = d.event_id AND f.student_id = d.student_id) AS "hasFeedback"
     FROM v_booking_details d
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY d.booked_at DESC
     LIMIT 500`,
    params,
  );
  return rows;
}
