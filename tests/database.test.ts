import { afterAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { pool } from './helpers';

/** Runs `fn` inside a transaction that is ALWAYS rolled back, so the seed data stays untouched. */
async function sandbox<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}
/** Executes SQL expecting a failure; returns the SQLSTATE code. */
async function failure(c: PoolClient, sql: string, params: unknown[] = []): Promise<string> {
  await c.query('SAVEPOINT s');
  try {
    await c.query(sql, params);
    return 'no-error';
  } catch (e: any) {
    await c.query('ROLLBACK TO SAVEPOINT s');
    return e.code;
  }
}
const id = async (c: PoolClient, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0].id as number;

afterAll(() => pool.end());

describe('PostgreSQL constraints, triggers, functions and procedures', () => {
  it('functions return correct counts', async () => {
    const { rows } = await pool.query(`SELECT confirmed_booking_count(event_id) AS n, seats_remaining(event_id) AS free, capacity FROM events WHERE title = 'Machine Learning Bootcamp'`);
    expect(rows[0].n).toBe(5);
    expect(rows[0].free).toBe(0);
    const att = await pool.query(`SELECT attendance_rate(event_id) AS pct FROM events WHERE title = 'Python for Beginners Workshop'`);
    expect(Number(att.rows[0].pct)).toBeCloseTo(83.3, 1);
  });

  it('trigger 1: event capacity cannot exceed venue capacity', () => sandbox(async (c) => {
    const code = await failure(c, `UPDATE events SET capacity = 9999 WHERE title = 'Robotics Workshop'`);
    expect(code).toBe('UE001');
  }));

  it('trigger 2: cancellation timestamps are maintained automatically', () => sandbox(async (c) => {
    const bid = await id(c, `SELECT MIN(booking_id) AS id FROM bookings WHERE status = 'confirmed'`);
    const r = await c.query(`UPDATE bookings SET status = 'cancelled' WHERE booking_id = $1 RETURNING cancelled_at`, [bid]);
    expect(r.rows[0].cancelled_at).not.toBeNull();
    const back = await c.query(`UPDATE events SET status = 'cancelled' WHERE title = 'Robotics Workshop' RETURNING cancelled_at`);
    expect(back.rows[0].cancelled_at).not.toBeNull();
  }));

  it('trigger 3: overbooking is rejected', () => sandbox(async (c) => {
    const ev = await id(c, `SELECT event_id AS id FROM events WHERE title = 'Machine Learning Bootcamp'`);
    const stu = await id(c, `SELECT user_id AS id FROM users WHERE email = 'diya.patel@college.edu'`);
    expect(await failure(c, 'INSERT INTO bookings (event_id, student_id) VALUES ($1, $2)', [ev, stu])).toBe('UE002');
  }));

  it('trigger 4: attendance needs a confirmed booking and an authorised marker', () => sandbox(async (c) => {
    const cancelledBooking = await id(c, `SELECT b.booking_id AS id FROM bookings b JOIN events e USING (event_id) WHERE e.title = 'Inter-College Football Friendly' LIMIT 1`);
    const org = await id(c, `SELECT user_id AS id FROM users WHERE email = 'priya.menon@college.edu'`);
    expect(await failure(c, 'INSERT INTO attendance (booking_id, attended, marked_by) VALUES ($1, true, $2)', [cancelledBooking, org])).toBe('UE004');
    const live = await id(c, `SELECT b.booking_id AS id FROM bookings b JOIN events e USING (event_id) WHERE e.title = 'Robotics Workshop' LIMIT 1`);
    const student = await id(c, `SELECT user_id AS id FROM users WHERE email = 'aarav.sharma@college.edu'`);
    expect(await failure(c, 'INSERT INTO attendance (booking_id, attended, marked_by) VALUES ($1, true, $2)', [live, student])).toBe('UE005');
  }));

  it('role triggers: organizers cannot hold bookings, students cannot own events', () => sandbox(async (c) => {
    const ev = await id(c, `SELECT event_id AS id FROM events WHERE title = 'Photography Workshop'`);
    const organizer = await id(c, `SELECT user_id AS id FROM users WHERE email = 'rajesh.kumar@college.edu'`);
    expect(await failure(c, 'INSERT INTO bookings (event_id, student_id) VALUES ($1, $2)', [ev, organizer])).toBe('UE005');
    const student = await id(c, `SELECT user_id AS id FROM users WHERE email = 'aarav.sharma@college.edu'`);
    expect(await failure(c, `UPDATE events SET organizer_id = $1 WHERE event_id = $2`, [student, ev])).toBe('UE005');
  }));

  it('feedback requires attendance', () => sandbox(async (c) => {
    const ev = await id(c, `SELECT event_id AS id FROM events WHERE title = 'Open Mic Night'`);
    const kabir = await id(c, `SELECT user_id AS id FROM users WHERE email = 'kabir.singh@college.edu'`);
    expect(await failure(c, 'INSERT INTO feedback (event_id, student_id, rating) VALUES ($1, $2, 5)', [ev, kabir])).toBe('UE006');
  }));

  it('constraints: duplicate booking, bad rating, unknown FK, venue overlap', () => sandbox(async (c) => {
    const row = (await c.query(`SELECT b.event_id, b.student_id FROM bookings b JOIN events e USING (event_id) WHERE b.status = 'confirmed' AND e.status = 'published' LIMIT 1`)).rows[0];
    expect(await failure(c, 'INSERT INTO bookings (event_id, student_id) VALUES ($1, $2)', [row.event_id, row.student_id])).toBe('23505');
    // rating 9 on an event the student really attended -> only the CHECK constraint can object
    const att = (await c.query(`SELECT b.event_id, b.student_id FROM bookings b JOIN attendance a USING (booking_id) WHERE a.attended AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.event_id = b.event_id AND f.student_id = b.student_id) LIMIT 1`)).rows[0];
    expect(att).toBeDefined();
    expect(await failure(c, 'INSERT INTO feedback (event_id, student_id, rating) VALUES ($1, $2, 9)', [att.event_id, att.student_id])).toBe('23514');
    expect(await failure(c, 'INSERT INTO bookings (event_id, student_id) VALUES (999999, $1)', [row.student_id])).toBe('UE008'); // trigger answers first
    expect(await failure(c, 'INSERT INTO student_interests (student_id, category_id) VALUES ($1, 999999)', [row.student_id])).toBe('23503'); // pure FK
    expect(await failure(c, `INSERT INTO events (title, category_id, venue_id, organizer_id, start_time, end_time, capacity, status)
      SELECT 'Clash', category_id, venue_id, organizer_id, start_time + interval '1 hour', end_time, 5, 'published' FROM events WHERE title = 'Robotics Workshop'`)).toBe('23P01');
  }));

  it('procedure cancel_event: atomic, returns count, and checks the caller', () => sandbox(async (c) => {
    const ev = await id(c, `SELECT event_id AS id FROM events WHERE title = 'Live Music Evening'`);
    const other = await id(c, `SELECT user_id AS id FROM users WHERE email = 'rajesh.kumar@college.edu'`);
    const owner = await id(c, `SELECT user_id AS id FROM users WHERE email = 'priya.menon@college.edu'`);
    expect(await failure(c, 'CALL cancel_event($1::int, $2::int, 0)', [ev, other])).toBe('UE007');
    const r = await c.query('CALL cancel_event($1::int, $2::int, 0)', [ev, owner]);
    expect(r.rows[0].p_cancelled_bookings).toBe(4);
    const left = await c.query(`SELECT COUNT(*)::int AS n FROM bookings WHERE event_id = $1 AND status = 'confirmed'`, [ev]);
    expect(left.rows[0].n).toBe(0);
  }));

  it('recursive view returns the full category path', async () => {
    const { rows } = await pool.query(`SELECT path, depth FROM v_category_paths WHERE name = 'Machine Learning'`);
    expect(rows[0].path).toBe('Technical > Artificial Intelligence > Machine Learning');
    expect(rows[0].depth).toBe(3);
  });

  it('pgvector: extension, 384-d column, HNSW index and cosine search', async () => {
    const ext = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
    expect(ext.rowCount).toBe(1);
    const dims = await pool.query(`SELECT MAX(vector_dims(embedding)) AS d, COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS n FROM events`);
    expect(dims.rows[0].d).toBe(384);
    expect(dims.rows[0].n).toBeGreaterThanOrEqual(10);
    const idx = await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_events_embedding_hnsw'`);
    expect(idx.rows[0].indexdef).toMatch(/hnsw.*vector_cosine_ops/);
    const nn = await pool.query(`SELECT * FROM similar_events((SELECT event_id FROM events WHERE title = 'Robotics Workshop'), 3)`);
    expect(nn.rowCount).toBe(3);
    expect(nn.rows[0].similarity).toBeGreaterThanOrEqual(nn.rows[1].similarity);
  });
});
