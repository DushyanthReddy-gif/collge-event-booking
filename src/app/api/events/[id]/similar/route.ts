import { route, parseId } from '@/lib/http';
import { similarEvents } from '@/lib/search/service';

export const GET = route(async (_req, p) => ({ events: await similarEvents(parseId(p.id)) }));
