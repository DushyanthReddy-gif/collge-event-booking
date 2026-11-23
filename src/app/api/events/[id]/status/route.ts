import { route, parseBody, parseId } from '@/lib/http';
import { eventStatusSchema } from '@/schemas';
import { requireUser } from '@/lib/auth/guard';
import { cancelEvent, publishEvent } from '@/lib/events/service';

// Publish a draft, or cancel an event (stored procedure cancel_event also cancels its bookings).
export const POST = route(async (req, p) => {
  const user = await requireUser(['organizer', 'admin']);
  const id = parseId(p.id);
  const { status } = await parseBody(req, eventStatusSchema);
  if (status === 'published') {
    await publishEvent(user, id);
    return { ok: true, status };
  }
  return { ok: true, status, ...(await cancelEvent(user, id)) };
});
