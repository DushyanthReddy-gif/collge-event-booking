import { route } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { listUsers } from '@/lib/admin/service';

export const GET = route(async () => {
  await requireUser(['admin']);
  return { users: await listUsers() };
});
