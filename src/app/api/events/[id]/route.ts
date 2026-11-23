import { route, parseBody, parseId } from '@/lib/http';
import { eventUpdateSchema } from '@/schemas';
import { getCurrentUser } from '@/lib/auth/session';
import { requireUser } from '@/lib/auth/guard';
import { deleteEvent, getEventDetail, updateEvent } from '@/lib/events/service';

export const GET = route(async (_req, p) => {
  const user = await getCurrentUser();
  return { event: await getEventDetail(user, parseId(p.id)) };
});

export const PUT = route(async (req, p) => {
  const user = await requireUser(['organizer', 'admin']);
  await updateEvent(user, parseId(p.id), await parseBody(req, eventUpdateSchema));
  return { ok: true };
});

export const DELETE = route(async (_req, p) => {
  const user = await requireUser(['organizer', 'admin']);
  await deleteEvent(user, parseId(p.id));
  return { ok: true };
});
