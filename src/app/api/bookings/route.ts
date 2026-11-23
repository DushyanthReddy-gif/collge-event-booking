import { route } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { listBookings } from '@/lib/bookings/service';

// student: own bookings | organizer: bookings of own events | admin: every booking
export const GET = route(async (req) => {
  const user = await requireUser();
  const eventId = Number(req.nextUrl.searchParams.get('eventId')) || undefined;
  return { bookings: await listBookings(user, { eventId }) };
});
