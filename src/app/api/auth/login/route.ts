import { route, parseBody } from '@/lib/http';
import { loginSchema } from '@/schemas';
import { authenticate } from '@/lib/auth/service';
import { setSessionCookie } from '@/lib/auth/session';
import { homeFor } from '@/lib/auth/guard';

export const POST = route(async (req) => {
  const { email, password } = await parseBody(req, loginSchema);
  const user = await authenticate(email, password);
  await setSessionCookie(user.userId);
  return { user, redirectTo: homeFor(user.role) };
});
