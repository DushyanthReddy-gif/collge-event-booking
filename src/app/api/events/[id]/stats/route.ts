import { route, parseId } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { getEventStats } from '@/lib/events/stats';

export const GET = route(async (_req, p) => getEventStats(await requireUser(['organizer', 'admin']), parseId(p.id)));
