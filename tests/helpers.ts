import { Pool } from 'pg';

export const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
export const PASSWORD = 'Password@123';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Tiny HTTP client with a cookie jar, so one instance == one logged-in browser. */
export class Client {
  private cookie = '';

  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair; // logout clears the cookie
    }
    const data: any = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);

  async login(email: string, password = PASSWORD) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.data)}`);
    return r;
  }
}

export async function loginAs(email: string) {
  const c = new Client();
  await c.login(email);
  return c;
}

export const ACCOUNTS = {
  admin: 'admin@college.edu',
  organizer1: 'rajesh.kumar@college.edu',
  organizer2: 'priya.menon@college.edu',
  student: 'aarav.sharma@college.edu',
};

let counter = 0;
/** Unique far-future slot so test events never clash with seed data or each other (venue overlap rule). */
export function slot(hours = 2) {
  const start = new Date(Date.now() + (500 + counter++ * 2) * 86400_000);
  start.setUTCHours(10, 0, 0, 0);
  return { startTime: start.toISOString(), endTime: new Date(start.getTime() + hours * 3600_000).toISOString() };
}

export async function meta(c: Client) {
  const { data } = await c.get('/api/meta');
  const venue = (name: string) => data.venues.find((v: any) => v.name === name).venueId as number;
  const category = (name: string) => data.categories.find((x: any) => x.name === name).categoryId as number;
  return { venue, category };
}

/** Creates and publishes a TEST event; returns its id. */
export async function createPublishedEvent(organizer: Client, capacity: number, title = `TEST event ${Date.now()}-${counter}`) {
  const m = await meta(organizer);
  const r = await organizer.post('/api/events', {
    title, description: 'Automated test event', categoryId: m.category('Workshop'), venueId: m.venue('Open Air Theatre'),
    capacity, status: 'published', ...slot(),
  });
  if (r.status !== 201) throw new Error('could not create test event: ' + JSON.stringify(r.data));
  return r.data.eventId as number;
}

let studentCounter = 0;
export async function registerStudent() {
  const c = new Client();
  const email = `t${Date.now()}_${studentCounter++}@test.edu`;
  const r = await c.post('/api/auth/register', { fullName: 'Test Student', email, password: 'TestPass123' });
  if (r.status !== 201) throw new Error('register failed: ' + JSON.stringify(r.data));
  return { client: c, email, userId: r.data.user.userId as number };
}

export async function cleanup() {
  await pool.query(`DELETE FROM events WHERE title LIKE 'TEST %'`);
  await pool.query(`DELETE FROM users WHERE email LIKE '%@test.edu'`);
  await pool.query(`DELETE FROM venues WHERE name LIKE 'TEST %'`);
}
