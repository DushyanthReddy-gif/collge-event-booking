import { requirePage } from '@/lib/auth/guard';
import StudentDashboard from '@/components/StudentDashboard';

export default async function Page() {
  const user = await requirePage(['student']);
  return <StudentDashboard name={user.fullName} />;
}
