import { query } from '@/lib/db/pool';
import { ApiError } from '@/lib/db/errors';
import { safeSync, syncUsers } from '@/lib/neo4j/sync';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';
import type { Role } from './session';

export interface AuthUser {
  userId: number;
  fullName: string;
  email: string;
  role: Role;
}

/** Self-registration ALWAYS creates a student. The role is never read from the request. */
export async function registerStudent(input: { fullName: string; email: string; password: string; department?: string }): Promise<AuthUser> {
  const hash = await hashPassword(input.password);
  const { rows } = await query<{ user_id: number }>(
    `INSERT INTO users (full_name, email, password_hash, role_id, department)
     VALUES ($1, $2, $3, (SELECT role_id FROM roles WHERE role_name = 'student'), $4)
     RETURNING user_id`,
    [input.fullName, input.email, hash, input.department ?? null],
  );
  const userId = rows[0].user_id;
  await safeSync('user registered', () => syncUsers([userId]));
  return { userId, fullName: input.fullName, email: input.email, role: 'student' };
}

export async function authenticate(email: string, password: string): Promise<AuthUser> {
  const { rows } = await query<{ user_id: number; full_name: string; email: string; password_hash: string; role_name: Role; is_active: boolean }>(
    `SELECT u.user_id, u.full_name, u.email, u.password_hash, r.role_name, u.is_active
     FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.email = $1`,
    [email],
  );
  const u = rows[0];
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH); // same cost for unknown e-mails
  if (!u || !ok) throw new ApiError(401, 'Invalid email or password');
  if (!u.is_active) throw new ApiError(403, 'This account has been deactivated');
  return { userId: u.user_id, fullName: u.full_name, email: u.email, role: u.role_name };
}
