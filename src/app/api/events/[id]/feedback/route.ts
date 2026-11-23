import { route, parseBody, parseId, created } from '@/lib/http';
import { feedbackSchema } from '@/schemas';
import { getCurrentUser } from '@/lib/auth/session';
import { requireUser } from '@/lib/auth/guard';
import { listFeedback, submitFeedback } from '@/lib/events/participants';

export const GET = route(async (_req, p) => ({ feedback: await listFeedback(await getCurrentUser(), parseId(p.id)) }));

export const POST = route(async (req, p) => {
  const user = await requireUser(['student']);
  const { rating, comment } = await parseBody(req, feedbackSchema);
  await submitFeedback(user, parseId(p.id), rating, comment);
  return created({ ok: true });
});
