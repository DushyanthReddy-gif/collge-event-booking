import { route, parseBody, parseId } from '@/lib/http';
import { attendanceSchema } from '@/schemas';
import { requireUser } from '@/lib/auth/guard';
import { markAttendance } from '@/lib/events/participants';

export const PUT = route(async (req, p) => {
  const user = await requireUser(['organizer', 'admin']);
  const { records } = await parseBody(req, attendanceSchema);
  return await markAttendance(user, parseId(p.id), records);
});
