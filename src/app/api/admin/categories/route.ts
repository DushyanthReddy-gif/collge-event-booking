import { route, parseBody, created } from '@/lib/http';
import { categorySchema } from '@/schemas';
import { requireUser } from '@/lib/auth/guard';
import { createCategory } from '@/lib/admin/service';

export const POST = route(async (req) => {
  await requireUser(['admin']);
  return created({ categoryId: await createCategory(await parseBody(req, categorySchema)) });
});
