import { route, parseBody, parseId } from '@/lib/http';
import { categorySchema } from '@/schemas';
import { requireUser } from '@/lib/auth/guard';
import { deleteCategory, updateCategory } from '@/lib/admin/service';

export const PUT = route(async (req, p) => {
  await requireUser(['admin']);
  await updateCategory(parseId(p.id), await parseBody(req, categorySchema));
  return { ok: true };
});
export const DELETE = route(async (_req, p) => {
  await requireUser(['admin']);
  await deleteCategory(parseId(p.id));
  return { ok: true };
});
