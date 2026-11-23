import { requirePage } from '@/lib/auth/guard';
import MyBookings from '@/components/MyBookings';

export default async function Page() {
  await requirePage(['student']);
  return <MyBookings />;
}
