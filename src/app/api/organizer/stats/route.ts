import { route } from '@/lib/http';
import { requireUser } from '@/lib/auth/guard';
import { getOrganizerStats } from '@/lib/events/stats';

export const GET = route(async () => getOrganizerStats(await requireUser(['organizer', 'admin'])));
