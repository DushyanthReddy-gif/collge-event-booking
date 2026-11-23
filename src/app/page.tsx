import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/session';
import { homeFor } from '@/lib/auth/guard';

export default async function Home() {
  const user = await getCurrentUser();
  return (
    <div className="space-y-10">
      <section className="rounded-lg bg-ink px-8 py-12 text-white">
        <h1 className="max-w-2xl text-3xl font-semibold leading-tight">Find a college event, book your seat, and never miss the ones you will like.</h1>
        <p className="mt-3 max-w-xl text-slate-300">Search by keyword or by meaning, get recommendations from what students like you attended, and book without worrying about overbooking.</p>
        <div className="mt-6 flex gap-3">
          <Link href="/events" className="btn bg-white text-ink hover:bg-slate-100">Browse events</Link>
          {user ? (
            <Link href={homeFor(user.role)} className="btn border border-white/40 text-white hover:bg-white/10">Go to my {user.role} page</Link>
          ) : (
            <Link href="/register" className="btn border border-white/40 text-white hover:bg-white/10">Create a student account</Link>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card"><h2>Students</h2><p className="mt-2 text-sm text-slate-600">Search events, book a seat, cancel, track your bookings and rate events you attended.</p></div>
        <div className="card"><h2>Organizers</h2><p className="mt-2 text-sm text-slate-600">Create and publish events, see who registered, mark attendance and follow ratings.</p></div>
        <div className="card"><h2>Admins</h2><p className="mt-2 text-sm text-slate-600">Manage users, venues, categories and events, and watch system-wide statistics.</p></div>
      </section>
    </div>
  );
}
