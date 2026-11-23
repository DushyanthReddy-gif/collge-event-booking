import { route, parseId, created } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { bookSeat } from '@/lib/bookings/service';

export const POST = route(async (_req, p) => {
  const user = await requireUser(['student']); // only students book seats
  return created(await bookSeat(user, parseId(p.id)));
});
