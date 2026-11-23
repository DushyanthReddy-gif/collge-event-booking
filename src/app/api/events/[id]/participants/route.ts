import { route, parseId } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { getParticipants } from '@/lib/events/participants';

export const GET = route(async (_req, p) => {
  const user = await requireUser(['organizer', 'admin']);
  return { participants: await getParticipants(user, parseId(p.id)) };
});
