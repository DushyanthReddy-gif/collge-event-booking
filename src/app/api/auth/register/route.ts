import { route, parseBody, created } from '@/lib/http';
import { registerSchema } from '@/schemas';
import { registerStudent } from '@/lib/auth/service';
import { setSessionCookie } from '@/lib/auth/session';

export const POST = route(async (req) => {
  const input = await parseBody(req, registerSchema);
  const user = await registerStudent(input);
  await setSessionCookie(user.userId);
  return created({ user });
});
