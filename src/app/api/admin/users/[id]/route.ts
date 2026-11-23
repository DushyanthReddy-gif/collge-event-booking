import { route, parseBody, parseId } from '@/lib/http';
import { userPatchSchema } from '@/schemas';
import { requireUser } from '@/lib/auth/guard';
import { patchUser } from '@/lib/admin/service';

export const PATCH = route(async (req, p) => {
  const admin = await requireUser(['admin']);
  await patchUser(admin, parseId(p.id), await parseBody(req, userPatchSchema));
  return { ok: true };
});
