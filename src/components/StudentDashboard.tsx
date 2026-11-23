'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDateTime } from '@/lib/client';
import { Alert, Loading } from '@/components/ui';
import type { Recommendation } from '@/lib/neo4j/recommendations';
import type { BookingRow } from '@/lib/bookings/service';

interface Category { categoryId: number; name: string }

export default function StudentDashboard({ name }: { name: string }) {
  const [recs, setRecs] = useState<{ source: string; recommendations: Recommendation[] } | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [interests, setInterests] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const loadRecs = useCallback(async () => {
    try { setRecs(await api('/api/recommendations')); } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    loadRecs();
    api<{ bookings: BookingRow[] }>('/api/bookings').then((d) => setBookings(d.bookings)).catch(() => undefined);
    api<{ categories: Category[] }>('/api/meta').then((d) => setCategories(d.categories)).catch(() => undefined);
    api<{ categoryIds: number[] }>('/api/interests').then((d) => setInterests(d.categoryIds)).catch(() => undefined);
  }, [loadRecs]);

  const toggle = (id: number) => { setSaved(false); setInterests((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])); };

  async function saveInterests() {
    try { await api('/api/interests', { method: 'PUT', body: { categoryIds: interests } }); setSaved(true); await loadRecs(); } catch (e) { setError((e as Error).message); }
  }

  const upcoming = bookings.filter((b) => b.bookingStatus === 'confirmed' && new Date(b.startTime) > new Date());

  return (
    <div className="space-y-8">
      <h1>Hello, {name.split(' ')[0]}</h1>
      {error && <Alert>{error}</Alert>}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2>Recommended for you</h2>
          {recs && <span className="text-xs text-slate-500">{recs.source === 'neo4j' ? 'Computed with Neo4j graph queries' : 'Neo4j is offline - showing popular events from PostgreSQL'}</span>}
        </div>
        {!recs ? <Loading /> : recs.recommendations.length === 0 ? (
          <p className="card text-sm text-slate-600">Nothing to recommend yet. Book an event or pick interests below.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recs.recommendations.map((r) => (
              <Link key={r.eventId} href={`/events/${r.eventId}`} className="card flex flex-col gap-1 hover:border-brand">
                <h3 className="font-semibold">{r.title}</h3>
                <p className="text-sm text-slate-600">{r.categoryName} · {fmtDateTime(r.startTime)}</p>
                <p className="text-xs text-brand-dark">{r.reasons.join(' · ')}</p>
                <p className="mt-1 text-xs text-slate-500">{r.seatsRemaining} seats left</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2>Your interests</h2>
        <p className="text-sm text-slate-600">These become LIKES relationships in the Neo4j graph and sharpen your recommendations.</p>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <label key={c.categoryId} className={`chip cursor-pointer border px-3 py-1 ${interests.includes(c.categoryId) ? 'border-brand bg-brand-light text-brand-dark' : 'border-slate-300 bg-white text-slate-700'}`}>
              <input type="checkbox" className="sr-only" checked={interests.includes(c.categoryId)} onChange={() => toggle(c.categoryId)} />{c.name}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3"><button className="btn-primary" onClick={saveInterests}>Save interests</button>{saved && <span className="text-sm text-emerald-700">Saved</span>}</div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between"><h2>Upcoming bookings</h2><Link className="text-sm text-brand underline" href="/my-bookings">All bookings</Link></div>
        {upcoming.length === 0 ? <p className="card text-sm text-slate-600">No upcoming bookings. <Link className="text-brand underline" href="/events">Find an event</Link></p> : (
          <ul className="card divide-y divide-slate-100 p-0">
            {upcoming.map((b) => <li key={b.bookingId} className="flex justify-between px-4 py-3 text-sm"><Link className="font-medium hover:underline" href={`/events/${b.eventId}`}>{b.eventTitle}</Link><span className="text-slate-600">{fmtDateTime(b.startTime)}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
