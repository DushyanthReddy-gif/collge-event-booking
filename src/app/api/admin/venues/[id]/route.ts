import { route, parseBody, parseId } from '@/lib/http';
import { venueSchema } from '@/schemas';
import { requireUser } from '@/lib/auth/guard';
import { deleteVenue, updateVenue } from '@/lib/admin/service';

export const PUT = route(async (req, p) => {
  await requireUser(['admin']);
  await updateVenue(parseId(p.id), await parseBody(req, venueSchema));
  return { ok: true };
});
export const DELETE = route(async (_req, p) => {
  await requireUser(['admin']);
  await deleteVenue(parseId(p.id));
  return { ok: true };
});
