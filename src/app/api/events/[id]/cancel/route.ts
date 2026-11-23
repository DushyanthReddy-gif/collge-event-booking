import { route, parseId } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { cancelBooking } from '@/lib/bookings/service';

// Cancels the CALLER's own booking - there is no way to name another student's booking.
export const POST = route(async (_req, p) => {
  const user = await requireUser(['student']);
  return await cancelBooking(user, parseId(p.id));
});
