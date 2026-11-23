import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { query } from '@/lib/db/pool';

export type Role = 'student' | 'organizer' | 'admin';

export interface SessionUser {
  userId: number;
  fullName: string;
  email: string;
  role: Role;
  department: string | null;
}

export const SESSION_COOKIE = 'ceb_session';
const MAX_AGE_SECONDS = 60 * 60 * 8;

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

/** The cookie holds only a signed user id. Role and active-flag are re-read from PostgreSQL on every request. */
export async function setSessionCookie(userId: number): Promise<void> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JavaScript (mitigates XSS token theft)
    sameSite: 'lax', // not sent on cross-site POSTs (mitigates CSRF)
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let userId: number;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    userId = Number(payload.sub);
    if (!Number.isInteger(userId)) return null;
  } catch {
    return null; // bad signature or expired
  }

  const { rows } = await query<{
    user_id: number;
    full_name: string;
    email: string;
    role_name: Role;
    department: string | null;
  }>(
    `SELECT u.user_id, u.full_name, u.email, r.role_name, u.department
     FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND u.is_active`,
    [userId],
  );
  const u = rows[0];
  if (!u) return null;
  return { userId: u.user_id, fullName: u.full_name, email: u.email, role: u.role_name, department: u.department };
}
