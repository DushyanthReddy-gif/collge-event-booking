import { requirePage } from '@/lib/auth/guard';
import AdminPanel from '@/components/AdminPanel';

export default async function Page() {
  await requirePage(['admin']);
  return <AdminPanel />;
}
