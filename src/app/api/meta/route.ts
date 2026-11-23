import { route } from '@/lib/http';
import { listCategories, listVenues } from '@/lib/admin/service';

export const GET = route(async () => ({ categories: await listCategories(), venues: await listVenues(true) }));
