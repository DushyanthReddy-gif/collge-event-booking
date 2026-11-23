import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/db/errors';
import { getCurrentUser, type Role, type SessionUser } from './session';

/**
 * API guard: 401 when not logged in, 403 when the role is not allowed.
 * Every protected route handler starts with a call to this function, so the rule
 * is enforced on the server no matter what the UI shows.
 */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, 'Please log in');
  if (roles && !roles.includes(user.role)) {
    throw new ApiError(403, `This action requires one of the roles: ${roles.join(', ')}`);
  }
  return user;
}

/** Page guard for server components: redirects instead of throwing. */
export async function requirePage(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (roles && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

export function homeFor(role: Role): string {
  return role === 'admin' ? '/admin' : role === 'organizer' ? '/organizer' : '/dashboard';
}
