'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

interface Props { user: { fullName: string; role: 'student' | 'organizer' | 'admin' } | null }

export default function Navbar({ user }: Props) {
  const router = useRouter();

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const link = 'rounded px-2 py-1 text-sm text-slate-200 hover:bg-white/10';
  return (
    <header className="bg-ink">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-3" aria-label="Main">
        <Link href="/" className="mr-4 text-base font-semibold text-white">Campus Events</Link>
        <Link href="/events" className={link}>Events</Link>
        {user?.role === 'student' && <Link href="/dashboard" className={link}>Dashboard</Link>}
        {user?.role === 'student' && <Link href="/my-bookings" className={link}>My bookings</Link>}
        {(user?.role === 'organizer' || user?.role === 'admin') && <Link href="/organizer" className={link}>Organizer</Link>}
        {user?.role === 'admin' && <Link href="/admin" className={link}>Admin</Link>}
        <span className="flex-1" />
        {user ? (
          <>
            <span className="mr-2 text-sm text-slate-300">{user.fullName} <span className="chip ml-1 bg-white/15 text-white">{user.role}</span></span>
            <button onClick={logout} className="rounded border border-white/30 px-3 py-1 text-sm text-white hover:bg-white/10">Log out</button>
          </>
        ) : (
          <>
            <Link href="/login" className={link}>Log in</Link>
            <Link href="/register" className="rounded bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-dark">Register</Link>
          </>
        )}
      </nav>
    </header>
  );
}
