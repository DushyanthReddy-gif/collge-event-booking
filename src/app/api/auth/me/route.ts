import { route } from '@/lib/http';
import { getCurrentUser } from '@/lib/auth/session';

export const GET = route(async () => ({ user: await getCurrentUser() }));
