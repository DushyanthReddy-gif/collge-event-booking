'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDateTime, useMe } from '@/lib/client';
import { Alert, EventCard, Loading, Stars, StatusBadge } from '@/components/ui';
import type { EventDetail, EventSummary } from '@/lib/events/service';

interface Feedback { feedbackId: number; rating: number; comment: string; author: string; createdAt: string }

export default function EventDetailView({ id }: { id: number }) {
  const { me } = useMe();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [similar, setSimilar] = useState<EventSummary[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    try {
      const [e, f, s] = await Promise.all([
        api<{ event: EventDetail }>(`/api/events/${id}`),
        api<{ feedback: Feedback[] }>(`/api/events/${id}/feedback`),
        api<{ events: EventSummary[] }>(`/api/events/${id}/similar`),
      ]);
      setEvent(e.event); setFeedback(f.feedback); setSimilar(s.events);
    } catch (err) { setError((err as Error).message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); setNotice(ok); await load(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (error && !event) return <Alert>{error}</Alert>;
  if (!event) return <Loading />;

  const v = event.viewer;
  const confirmed = v.booking?.status === 'confirmed';
  const open = event.status === 'published' && new Date(event.endTime) > new Date();
  const soldOut = event.seatsRemaining <= 0;

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1>{event.title}</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><span className="chip bg-slate-100 text-slate-700">{event.categoryName}</span><StatusBadge status={event.status} /></p>
          </div>
          <Stars value={event.avgRating} />
        </div>
        <p className="whitespace-pre-line text-slate-700">{event.description || 'No description yet.'}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Starts</dt><dd className="font-medium">{fmtDateTime(event.startTime)}</dd></div>
          <div><dt className="text-slate-500">Ends</dt><dd className="font-medium">{fmtDateTime(event.endTime)}</dd></div>
          <div><dt className="text-slate-500">Venue</dt><dd className="font-medium">{event.venueName} <span className="font-normal text-slate-500">({event.venueLocation})</span></dd></div>
          <div><dt className="text-slate-500">Organizer</dt><dd className="font-medium">{event.organizerName}</dd></div>
          <div><dt className="text-slate-500">Seats</dt><dd className="font-medium">{event.confirmedBookings} booked of {event.capacity} ({Math.max(event.seatsRemaining, 0)} left)</dd></div>
        </dl>

        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        {event.status === 'cancelled' && <Alert>This event has been cancelled.</Alert>}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          {!me && open && <Link href="/login" className="btn-primary">Log in to book a seat</Link>}
          {me?.role === 'student' && open && !confirmed && (
            <button className="btn-primary" disabled={busy || soldOut} onClick={() => act(() => api(`/api/events/${id}/book`, { method: 'POST' }), 'Seat booked!')}>
              {soldOut ? 'Sold out' : busy ? 'Booking...' : 'Book a seat'}
            </button>
          )}
          {me?.role === 'student' && confirmed && open && (
            <>
              <span className="chip bg-emerald-100 text-emerald-800">You are booked</span>
              <button className="btn-secondary" disabled={busy} onClick={() => act(() => api(`/api/events/${id}/cancel`, { method: 'POST' }), 'Booking cancelled.')}>Cancel my booking</button>
            </>
          )}
          {v.canManage && <Link href="/organizer" className="btn-secondary">Manage this event</Link>}
          {me && me.role !== 'student' && !v.canManage && <span className="text-sm text-slate-500">Only students can book seats.</span>}
        </div>
      </div>

      {me?.role === 'student' && v.attended && !v.feedback && (
        <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); act(() => api(`/api/events/${id}/feedback`, { method: 'POST', body: { rating, comment } }), 'Thanks for your feedback!'); }}>
          <h2>Rate this event</h2>
          <div className="flex items-center gap-2">
            <label className="label mb-0" htmlFor="rating">Rating</label>
            <select id="rating" className="input w-24" value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}</select>
          </div>
          <textarea className="input" rows={3} placeholder="What did you think?" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn-primary" disabled={busy}>Submit feedback</button>
        </form>
      )}
      {v.feedback && <Alert kind="info">You rated this event {v.feedback.rating} ★.</Alert>}

      <section className="card space-y-3">
        <h2>Feedback ({feedback.length})</h2>
        {feedback.length === 0 && <p className="text-sm text-slate-500">Only students who attended can leave feedback, so there is none yet.</p>}
        {feedback.map((f) => (
          <div key={f.feedbackId} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
            <p className="text-sm"><span className="font-medium">{f.author}</span> <Stars value={f.rating} /></p>
            {f.comment && <p className="text-sm text-slate-600">{f.comment}</p>}
          </div>
        ))}
      </section>

      {similar.length > 0 && (
        <section className="space-y-3">
          <h2>Similar events <span className="text-sm font-normal text-slate-500">(pgvector nearest neighbours)</span></h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{similar.map((e) => <EventCard key={e.eventId} e={e} />)}</div>
        </section>
      )}
    </div>
  );
}
