import { route } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { getSystemStats } from '@/lib/admin/service';

export const GET = route(async () => {
  await requireUser(['admin']);
  return getSystemStats();
});
