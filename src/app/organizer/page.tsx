import { requirePage } from '@/lib/auth/guard';
import EventManager from '@/components/EventManager';

export default async function Page() {
  const user = await requirePage(['organizer', 'admin']);
  return (
    <div className="space-y-4">
      <h1>Organizer workspace</h1>
      <EventManager isAdmin={user.role === 'admin'} />
    </div>
  );
}
