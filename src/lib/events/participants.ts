import type { SessionUser } from '@/lib/auth/session';
import { query, withTransaction } from '@/lib/db/pool';
import { ApiError } from '@/lib/db/errors';
import { safeSync, syncStudentEventLinks } from '@/lib/neo4j/sync';
import { assertCanManage } from './service';

export interface Participant {
  bookingId: number;
  studentId: number;
  studentName: string;
  studentEmail: string;
  bookedAt: string;
  attended: boolean | null;
}

/** Organizer/admin: confirmed participants of one event with their attendance state. */
export async function getParticipants(user: SessionUser, eventId: number): Promise<Participant[]> {
  await assertCanManage(user, eventId);
  const { rows } = await query<Participant>(
    `SELECT booking_id AS "bookingId", student_id AS "studentId", student_name AS "studentName",
            student_email AS "studentEmail", booked_at AS "bookedAt", attended
     FROM v_booking_details
     WHERE event_id = $1 AND booking_status = 'confirmed'
     ORDER BY student_name`,
    [eventId],
  );
  return rows;
}

/**
 * Marks attendance for several bookings in one transaction (all-or-nothing).
 * The validate_attendance trigger additionally verifies that each booking is confirmed
 * and that the marking user is the event's organizer or an admin.
 */
export async function markAttendance(
  user: SessionUser,
  eventId: number,
  records: { bookingId: number; attended: boolean }[],
): Promise<{ updated: number }> {
  await assertCanManage(user, eventId);
  await withTransaction(async (client) => {
    for (const r of records) {
      const own = await client.query('SELECT 1 FROM bookings WHERE booking_id = $1 AND event_id = $2', [r.bookingId, eventId]);
      if (own.rowCount === 0) throw new ApiError(400, `Booking ${r.bookingId} does not belong to this event`);
      await client.query(
        `INSERT INTO attendance (booking_id, attended, marked_by) VALUES ($1, $2, $3)
         ON CONFLICT (booking_id) DO UPDATE SET attended = EXCLUDED.attended, marked_by = EXCLUDED.marked_by, marked_at = now()`,
        [r.bookingId, r.attended, user.userId],
      );
    }
  });
  await safeSync('attendance', () => syncStudentEventLinks({ eventIds: [eventId] }));
  return { updated: records.length };
}

export interface FeedbackRow {
  feedbackId: number;
  rating: number;
  comment: string;
  author: string;
  createdAt: string;
}

export async function submitFeedback(user: SessionUser, eventId: number, rating: number, comment: string): Promise<void> {
  // students only (route guard) - the DB trigger additionally requires attended = TRUE
  const ev = await query('SELECT 1 FROM events WHERE event_id = $1', [eventId]);
  if (ev.rowCount === 0) throw new ApiError(404, 'Event not found');
  await query('INSERT INTO feedback (event_id, student_id, rating, comment) VALUES ($1, $2, $3, $4)', [eventId, user.userId, rating, comment]);
}

export async function listFeedback(user: SessionUser | null, eventId: number): Promise<FeedbackRow[]> {
  const manager = user && (user.role === 'admin' || user.role === 'organizer');
  const { rows } = await query<FeedbackRow>(
    `SELECT f.feedback_id AS "feedbackId", f.rating, f.comment,
            CASE WHEN $2 THEN u.full_name ELSE split_part(u.full_name, ' ', 1) END AS author,
            f.created_at AS "createdAt"
     FROM feedback f JOIN users u ON u.user_id = f.student_id
     WHERE f.event_id = $1 ORDER BY f.created_at DESC LIMIT 100`,
    [eventId, !!manager],
  );
  return rows;
}
