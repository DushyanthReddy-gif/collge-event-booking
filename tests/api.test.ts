import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, BASE, Client, cleanup, createPublishedEvent, loginAs, meta, pool, registerStudent, slot } from './helpers';

beforeAll(async () => {
  try {
    await fetch(BASE + '/api/meta');
  } catch {
    throw new Error(`The app is not reachable at ${BASE}. Start it first: npm run dev (or npm run build && npm start).`);
  }
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('registration and login', () => {
  it('registers a student, hashes the password, ignores a role in the body', async () => {
    const c = new Client();
    const email = `reg${Date.now()}@test.edu`;
    const r = await c.post('/api/auth/register', { fullName: 'Reg Test', email, password: 'Secret123', role: 'admin' });
    expect(r.status).toBe(201);
    expect(r.data.user.role).toBe('student'); // privilege escalation attempt ignored
    expect((await c.get('/api/auth/me')).data.user.email).toBe(email);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/); // bcrypt, never plaintext
    expect(rows[0].password_hash).not.toContain('Secret123');
  });

  it('rejects duplicate e-mail (409) and weak passwords (400)', async () => {
    const s = await registerStudent();
    const dup = await new Client().post('/api/auth/register', { fullName: 'Dup', email: s.email, password: 'Secret123' });
    expect(dup.status).toBe(409);
    const weak = await new Client().post('/api/auth/register', { fullName: 'Weak', email: `w${Date.now()}@test.edu`, password: 'short' });
    expect(weak.status).toBe(400);
  });

  it('logs in, logs out, and rejects bad credentials', async () => {
    const c = new Client();
    expect((await c.post('/api/auth/login', { email: ACCOUNTS.student, password: 'wrong-password' })).status).toBe(401);
    expect((await c.post('/api/auth/login', { email: 'nobody@college.edu', password: 'Password@123' })).status).toBe(401);
    const ok = await c.login(ACCOUNTS.student);
    expect(ok.data.redirectTo).toBe('/dashboard');
    expect((await c.get('/api/auth/me')).data.user.role).toBe('student');
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).data.user).toBeNull();
  });

  it('refuses a forged session cookie', async () => {
    const c = new Client();
    (c as any).cookie = 'ceb_session=not.a.valid.token';
    expect((await c.get('/api/bookings')).status).toBe(401);
  });
});

describe('unauthorised access and role restrictions (enforced by the API, not the UI)', () => {
  it('anonymous callers get 401 on protected routes', async () => {
    const c = new Client();
    expect((await c.post('/api/events/1/book')).status).toBe(401);
    expect((await c.get('/api/bookings')).status).toBe(401);
    expect((await c.get('/api/recommendations')).status).toBe(401);
    expect((await c.get('/api/admin/stats')).status).toBe(401);
    expect((await c.post('/api/events', {})).status).toBe(401);
  });

  it('students cannot use organizer or admin endpoints', async () => {
    const s = await loginAs(ACCOUNTS.student);
    const m = await meta(s);
    const create = await s.post('/api/events', { title: 'TEST hack', categoryId: m.category('Workshop'), venueId: m.venue('Seminar Hall A'), capacity: 5, ...slot() });
    expect(create.status).toBe(403);
    expect((await s.get('/api/events/1/participants')).status).toBe(403);
    expect((await s.put('/api/events/1/attendance', { records: [{ bookingId: 1, attended: true }] })).status).toBe(403);
    expect((await s.get('/api/events?scope=manage')).status).toBe(403);
    expect((await s.get('/api/admin/stats')).status).toBe(403);
    expect((await s.get('/api/admin/users')).status).toBe(403);
    expect((await s.post('/api/admin/venues', { name: 'TEST venue', capacity: 10 })).status).toBe(403);
  });

  it('organizers cannot book seats or use admin endpoints', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    expect((await o.post('/api/events/1/book')).status).toBe(403);
    expect((await o.get('/api/admin/stats')).status).toBe(403);
    expect((await o.patch('/api/admin/users/2', { isActive: false })).status).toBe(403);
    expect((await o.get('/api/recommendations')).status).toBe(403);
  });

  it('admin can reach admin endpoints', async () => {
    const a = await loginAs(ACCOUNTS.admin);
    const stats = await a.get('/api/admin/stats');
    expect(stats.status).toBe(200);
    expect(stats.data.popularEvents.length).toBeGreaterThan(0);
    expect((await a.get('/api/admin/users')).data.users.length).toBeGreaterThanOrEqual(13);
    expect((await a.get('/api/bookings')).data.bookings.length).toBeGreaterThan(10); // admin sees every booking
  });

  it('draft events are hidden from the public', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    const m = await meta(o);
    const r = await o.post('/api/events', { title: 'TEST draft', description: 'x', categoryId: m.category('Workshop'), venueId: m.venue('Open Air Theatre'), capacity: 10, ...slot() });
    expect(r.status).toBe(201);
    expect((await new Client().get(`/api/events/${r.data.eventId}`)).status).toBe(404);
    expect((await o.get(`/api/events/${r.data.eventId}`)).status).toBe(200);
  });
});

describe('organizer ownership', () => {
  it('an organizer can manage their own event but not another organizer\'s', async () => {
    const o1 = await loginAs(ACCOUNTS.organizer1);
    const o2 = await loginAs(ACCOUNTS.organizer2);
    const admin = await loginAs(ACCOUNTS.admin);
    const id = await createPublishedEvent(o1, 10, 'TEST ownership');
    expect((await o1.put(`/api/events/${id}`, { description: 'updated by owner' })).status).toBe(200);
    expect((await o2.put(`/api/events/${id}`, { description: 'hijack' })).status).toBe(403);
    expect((await o2.get(`/api/events/${id}/participants`)).status).toBe(403);
    expect((await o2.post(`/api/events/${id}/status`, { status: 'cancelled' })).status).toBe(403);
    expect((await admin.put(`/api/events/${id}`, { description: 'updated by admin' })).status).toBe(200);
    const mine = await o1.get('/api/events?scope=manage&when=all');
    expect(mine.data.events.every((e: any) => e.organizerId === (mine.data.events[0] as any).organizerId)).toBe(true);
  });

  it('rejects capacity above venue capacity (database trigger) and invalid input', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    const m = await meta(o);
    const tooBig = await o.post('/api/events', { title: 'TEST too big', categoryId: m.category('Workshop'), venueId: m.venue('Computer Lab 3'), capacity: 61, ...slot() });
    expect(tooBig.status).toBe(400);
    expect(tooBig.data.error).toMatch(/exceeds venue capacity/);
    const badDates = await o.post('/api/events', { title: 'TEST dates', categoryId: m.category('Workshop'), venueId: m.venue('Computer Lab 3'), capacity: 5, startTime: '2030-01-02T10:00:00Z', endTime: '2030-01-01T10:00:00Z' });
    expect(badDates.status).toBe(400);
  });
});

describe('booking rules', () => {
  it('books, blocks duplicates, cancels, and allows re-booking', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    const id = await createPublishedEvent(o, 5, 'TEST booking basics');
    const s = await registerStudent();
    expect((await s.client.post(`/api/events/${id}/book`)).status).toBe(201);
    const dup = await s.client.post(`/api/events/${id}/book`);
    expect(dup.status).toBe(409);
    expect(dup.data.error).toMatch(/already/);
    const mine = await s.client.get('/api/bookings');
    expect(mine.data.bookings.filter((b: any) => b.eventId === id && b.bookingStatus === 'confirmed')).toHaveLength(1);
    expect((await s.client.post(`/api/events/${id}/cancel`)).status).toBe(200);
    expect((await s.client.post(`/api/events/${id}/cancel`)).status).toBe(404); // nothing left to cancel
    expect((await s.client.post(`/api/events/${id}/book`)).status).toBe(201); // re-book works
    const { rows } = await pool.query(`SELECT confirmed_booking_count($1) AS n`, [id]);
    expect(rows[0].n).toBe(1);
  });

  it('refuses booking when the event is full', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    const id = await createPublishedEvent(o, 2, 'TEST capacity');
    const [a, b, c] = await Promise.all([registerStudent(), registerStudent(), registerStudent()]);
    expect((await a.client.post(`/api/events/${id}/book`)).status).toBe(201);
    expect((await b.client.post(`/api/events/${id}/book`)).status).toBe(201);
    const third = await c.client.post(`/api/events/${id}/book`);
    expect(third.status).toBe(409);
    expect(third.data.error).toMatch(/fully booked/);
  });

  it('cannot book drafts, cancelled or past events', async () => {
    const s = await loginAs(ACCOUNTS.student);
    const events = (await s.get('/api/events?when=past')).data.events;
    expect((await s.post(`/api/events/${events[0].eventId}/book`)).status).toBe(409); // past
    const draft = (await pool.query(`SELECT event_id FROM events WHERE status = 'draft' LIMIT 1`)).rows[0].event_id;
    expect((await s.post(`/api/events/${draft}/book`)).status).toBe(409);
    expect((await s.post(`/api/events/999999/book`)).status).toBe(404);
  });

  it('CONCURRENCY: 12 simultaneous bookings for 3 seats -> exactly 3 succeed', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    const id = await createPublishedEvent(o, 3, 'TEST concurrency');
    const students = await Promise.all(Array.from({ length: 12 }, () => registerStudent()));
    const results = await Promise.all(students.map((s) => s.client.post(`/api/events/${id}/book`)));
    const ok = results.filter((r) => r.status === 201).length;
    const full = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(3);
    expect(full).toBe(9);
    const { rows } = await pool.query(`SELECT confirmed_booking_count($1) AS n`, [id]);
    expect(rows[0].n).toBe(3); // never 4 or more
  });

  it('CONCURRENCY (database level): the trigger alone also prevents overbooking', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    const id = await createPublishedEvent(o, 3, 'TEST db concurrency');
    const students = await Promise.all(Array.from({ length: 10 }, () => registerStudent()));
    // raw INSERTs on separate connections, deliberately bypassing the API's own check
    const outcomes = await Promise.all(students.map(async (s) => {
      try {
        await pool.query('INSERT INTO bookings (event_id, student_id) VALUES ($1, $2)', [id, s.userId]);
        return 'ok';
      } catch (e: any) {
        return e.code as string;
      }
    }));
    expect(outcomes.filter((x) => x === 'ok')).toHaveLength(3);
    expect(outcomes.filter((x) => x === 'UE002')).toHaveLength(7);
  });
});

describe('cancelling an event, attendance and feedback', () => {
  it('cancel_event procedure cancels the event and all bookings', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    const id = await createPublishedEvent(o, 5, 'TEST cancel event');
    const s1 = await registerStudent();
    const s2 = await registerStudent();
    await s1.client.post(`/api/events/${id}/book`);
    await s2.client.post(`/api/events/${id}/book`);
    const r = await o.post(`/api/events/${id}/status`, { status: 'cancelled' });
    expect(r.status).toBe(200);
    expect(r.data.cancelledBookings).toBe(2);
    const b = await s1.client.get('/api/bookings');
    expect(b.data.bookings.find((x: any) => x.eventId === id).bookingStatus).toBe('cancelled');
    expect((await s1.client.post(`/api/events/${id}/book`)).status).toBe(409);
    expect((await o.post(`/api/events/${id}/status`, { status: 'cancelled' })).status).toBe(409); // already cancelled
  });

  it('attendance: organizer marks it, others cannot, cancelled bookings are rejected by the trigger', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    const o2 = await loginAs(ACCOUNTS.organizer2);
    const id = await createPublishedEvent(o, 5, 'TEST attendance');
    const present = await registerStudent();
    const cancelled = await registerStudent();
    await present.client.post(`/api/events/${id}/book`);
    await cancelled.client.post(`/api/events/${id}/book`);
    await cancelled.client.post(`/api/events/${id}/cancel`);

    const parts = await o.get(`/api/events/${id}/participants`);
    expect(parts.status).toBe(200);
    expect(parts.data.participants).toHaveLength(1);
    const bookingId = parts.data.participants[0].bookingId;

    expect((await present.client.put(`/api/events/${id}/attendance`, { records: [{ bookingId, attended: true }] })).status).toBe(403);
    expect((await o2.put(`/api/events/${id}/attendance`, { records: [{ bookingId, attended: true }] })).status).toBe(403);
    expect((await o.put(`/api/events/${id}/attendance`, { records: [{ bookingId, attended: true }] })).status).toBe(200);
    expect((await o.get(`/api/events/${id}/participants`)).data.participants[0].attended).toBe(true);

    const cancelledBooking = (await pool.query(`SELECT booking_id FROM bookings WHERE event_id = $1 AND status = 'cancelled'`, [id])).rows[0].booking_id;
    const bad = await o.put(`/api/events/${id}/attendance`, { records: [{ bookingId: cancelledBooking, attended: true }] });
    expect(bad.status).toBe(409);
    expect(bad.data.error).toMatch(/confirmed booking/);
    const stats = await o.get(`/api/events/${id}/stats`);
    expect(stats.status).toBe(200);
    expect(stats.data.attendancePercent).toBe(100);
  });

  it('feedback: only after attending, once, rating 1-5', async () => {
    const o = await loginAs(ACCOUNTS.organizer1);
    const id = await createPublishedEvent(o, 5, 'TEST feedback');
    const s = await registerStudent();
    await s.client.post(`/api/events/${id}/book`);

    const early = await s.client.post(`/api/events/${id}/feedback`, { rating: 5, comment: 'great' });
    expect(early.status).toBe(403); // booked but not marked present
    expect(early.data.error).toMatch(/attended/);

    const bookingId = (await o.get(`/api/events/${id}/participants`)).data.participants[0].bookingId;
    await o.put(`/api/events/${id}/attendance`, { records: [{ bookingId, attended: true }] });

    expect((await s.client.post(`/api/events/${id}/feedback`, { rating: 6 })).status).toBe(400);
    expect((await s.client.post(`/api/events/${id}/feedback`, { rating: 4, comment: 'good' })).status).toBe(201);
    expect((await s.client.post(`/api/events/${id}/feedback`, { rating: 5 })).status).toBe(409); // once only
    const list = await new Client().get(`/api/events/${id}/feedback`);
    expect(list.data.feedback).toHaveLength(1);
    expect((await o.get(`/api/events/${id}`)).data.event.avgRating).toBe(4);
  });
});

describe('admin management', () => {
  it('creates and deletes a venue; refuses deleting a venue in use; protects self', async () => {
    const a = await loginAs(ACCOUNTS.admin);
    const v = await a.post('/api/admin/venues', { name: 'TEST venue', location: 'Nowhere', capacity: 20 });
    expect(v.status).toBe(201);
    expect((await a.del(`/api/admin/venues/${v.data.venueId}`)).status).toBe(200);
    const inUse = (await pool.query(`SELECT venue_id FROM venues WHERE name = 'Main Auditorium'`)).rows[0].venue_id;
    expect((await a.del(`/api/admin/venues/${inUse}`)).status).toBe(409); // FK RESTRICT
    const me = (await a.get('/api/auth/me')).data.user.userId;
    expect((await a.patch(`/api/admin/users/${me}`, { isActive: false })).status).toBe(409);
  });

  it('a deactivated user loses access immediately', async () => {
    const a = await loginAs(ACCOUNTS.admin);
    const s = await registerStudent();
    expect((await s.client.get('/api/bookings')).status).toBe(200);
    expect((await a.patch(`/api/admin/users/${s.userId}`, { isActive: false })).status).toBe(200);
    expect((await s.client.get('/api/bookings')).status).toBe(401);
  });

  it('prevents category cycles using a recursive query', async () => {
    const a = await loginAs(ACCOUNTS.admin);
    const m = await meta(a);
    const technical = m.category('Technical');
    const ml = m.category('Machine Learning');
    const r = await a.put(`/api/admin/categories/${technical}`, { name: 'Technical', description: '', parentCategoryId: ml });
    expect(r.status).toBe(400);
  });
});

describe('recommendations (Neo4j) and search (PostgreSQL / pgvector)', () => {
  it('returns recommendations for students only; falls back to PostgreSQL if Neo4j is down', async () => {
    const s = await loginAs(ACCOUNTS.student);
    const r = await s.get('/api/recommendations');
    expect(r.status).toBe(200);
    expect(['neo4j', 'postgres-fallback']).toContain(r.data.source);
    expect(Array.isArray(r.data.recommendations)).toBe(true);
    expect(r.data.recommendations.length).toBeGreaterThan(0);
    for (const rec of r.data.recommendations) expect(typeof rec.seatsRemaining).toBe('number'); // bigint must not leak as a string
    const booked = new Set((await s.get('/api/bookings')).data.bookings.filter((b: any) => b.bookingStatus === 'confirmed').map((b: any) => b.eventId));
    for (const rec of r.data.recommendations) expect(booked.has(rec.eventId)).toBe(false); // never recommends what is already booked
  });

  it('keyword search uses full-text search', async () => {
    const r = await new Client().get('/api/search?q=cricket&mode=keyword');
    expect(r.status).toBe(200);
    expect(r.data.results.map((e: any) => e.title)).toContain('Inter-Department Cricket Tournament');
  });

  it('semantic search ranks events by vector similarity', async () => {
    const r = await new Client().get('/api/search?mode=semantic&q=' + encodeURIComponent('robotics and AI workshop'));
    expect(r.status).toBe(200);
    expect(r.data.mode).toBe('semantic');
    const sims: number[] = r.data.results.map((e: any) => e.similarity);
    expect(sims.length).toBeGreaterThan(3);
    expect([...sims].sort((x, y) => y - x)).toEqual(sims); // ranked best-first
    expect(r.data.results.slice(0, 3).map((e: any) => e.title)).toContain('Robotics Workshop');
  });

  it('semantic search finds related events without the exact words', async () => {
    const r = await new Client().get('/api/search?mode=semantic&q=' + encodeURIComponent('building robots with sensors and automation'));
    expect(r.data.results[0].title).toMatch(/Robotics/);
  });

  it('"similar events" endpoint uses pgvector neighbours', async () => {
    const id = (await pool.query(`SELECT event_id FROM events WHERE title = 'Machine Learning Bootcamp'`)).rows[0].event_id;
    const r = await new Client().get(`/api/events/${id}/similar`);
    expect(r.status).toBe(200);
    expect(r.data.events.length).toBeGreaterThan(0);
    expect(r.data.events.every((e: any) => e.eventId !== id)).toBe(true);
  });
});
