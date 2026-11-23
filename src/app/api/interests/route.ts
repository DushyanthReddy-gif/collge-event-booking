import { route, parseBody } from '@/lib/http';
import { interestsSchema } from '@/schemas';
import { requireUser } from '@/lib/auth/guard';
import { getInterests, setInterests } from '@/lib/auth/interests';

export const GET = route(async () => ({ categoryIds: await getInterests(await requireUser(['student'])) }));

export const PUT = route(async (req) => {
  const user = await requireUser(['student']);
  await setInterests(user, (await parseBody(req, interestsSchema)).categoryIds);
  return { ok: true };
});
