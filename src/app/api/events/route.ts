import { route, parseBody, parseQuery, created } from '@/lib/http';
import { eventCreateSchema, eventFilterSchema } from '@/schemas';
import { getCurrentUser } from '@/lib/auth/session';
import { requireUser } from '@/lib/auth/guard';
import { createEvent, listEvents } from '@/lib/events/service';

// Public: published events. scope=manage requires organizer/admin (checked in the service).
export const GET = route(async (req) => {
  const filters = parseQuery(req, eventFilterSchema);
  const user = await getCurrentUser();
  return { events: await listEvents(user, filters) };
});

// Organizer or admin only
export const POST = route(async (req) => {
  const user = await requireUser(['organizer', 'admin']);
  const input = await parseBody(req, eventCreateSchema);
  return created({ eventId: await createEvent(user, input) });
});
