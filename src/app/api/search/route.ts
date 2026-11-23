import { route, parseQuery } from '@/lib/http';
import { searchSchema } from '@/schemas';
import { searchEvents } from '@/lib/search/service';

// GET /api/search?q=robotics and AI workshop&mode=semantic|keyword
export const GET = route(async (req) => searchEvents(parseQuery(req, searchSchema)));
