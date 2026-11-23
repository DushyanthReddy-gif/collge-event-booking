import { route, parseBody, created } from '@/lib/http';
import { venueSchema } from '@/schemas';
import { requireUser } from '@/lib/auth/guard';
import { createVenue, listVenues } from '@/lib/admin/service';

export const GET = route(async () => {
  await requireUser(['admin']);
  return { venues: await listVenues(false) };
});
export const POST = route(async (req) => {
  await requireUser(['admin']);
  return created({ venueId: await createVenue(await parseBody(req, venueSchema)) });
});
