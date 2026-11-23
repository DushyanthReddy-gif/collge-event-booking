import { route } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { completeFinishedEvents } from '@/lib/admin/service';

// Calls the stored procedure complete_finished_events()
export const POST = route(async () => {
  await requireUser(['admin']);
  return { updated: await completeFinishedEvents() };
});
