'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDateTime, toLocalInput } from '@/lib/client';
import { Alert, Loading, Stat, StatusBadge } from '@/components/ui';
import type { EventSummary } from '@/lib/events/service';
import type { Participant } from '@/lib/events/participants';

interface Category { categoryId: number; name: string; path: string }
interface Venue { venueId: number; name: string; capacity: number }
interface Stats {
  fillPercent: number; attendancePercent: number; cancelledBookings: number;
  bookingsPerDay: { day: string; confirmed: number; cancelled: number }[];
  ratingDistribution: { rating: number; count: number }[];
}

const emptyForm = { title: '', description: '', categoryId: '', venueId: '', start: '', end: '', capacity: '30', status: 'draft' };

export default function EventManager({ isAdmin }: { isAdmin: boolean }) {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<EventSummary | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [marks, setMarks] = useState<Record<number, boolean>>({});
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    try { setEvents((await api<{ events: EventSummary[] }>('/api/events?scope=manage&when=all&limit=100')).events); } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    load();
    api<{ categories: Category[]; venues: Venue[] }>('/api/meta').then((d) => { setCategories(d.categories); setVenues(d.venues); }).catch(() => undefined);
  }, [load]);

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  function startEdit(ev: EventSummary) {
    setEditingId(ev.eventId);
    setForm({ title: ev.title, description: ev.description, categoryId: String(ev.categoryId), venueId: String(ev.venueId), start: toLocalInput(ev.startTime), end: toLocalInput(ev.endTime), capacity: String(ev.capacity), status: ev.status });
    setShowForm(true); setError(''); setNotice('');
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError(''); setNotice('');
    try { await fn(); setNotice(ok); await load(); } catch (e) { setError((e as Error).message); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      title: form.title, description: form.description, categoryId: Number(form.categoryId), venueId: Number(form.venueId),
      startTime: new Date(form.start).toISOString(), endTime: new Date(form.end).toISOString(), capacity: Number(form.capacity),
    };
    if (editingId === null) body.status = form.status;
    await run(async () => {
      if (editingId === null) await api('/api/events', { method: 'POST', body });
      else await api(`/api/events/${editingId}`, { method: 'PUT', body });
      setShowForm(false); setEditingId(null); setForm(emptyForm);
    }, editingId === null ? 'Event created.' : 'Event updated.');
  }

  async function openParticipants(ev: EventSummary) {
    setSelected(ev); setError(''); setStats(null);
    try {
      const [p, s] = await Promise.all([
        api<{ participants: Participant[] }>(`/api/events/${ev.eventId}/participants`),
        api<Stats>(`/api/events/${ev.eventId}/stats`),
      ]);
      setParticipants(p.participants); setStats(s);
      setMarks(Object.fromEntries(p.participants.filter((x) => x.attended !== null).map((x) => [x.bookingId, !!x.attended])));
    } catch (e) { setError((e as Error).message); }
  }

  async function saveAttendance() {
    if (!selected) return;
    const records = participants.filter((p) => marks[p.bookingId] !== undefined).map((p) => ({ bookingId: p.bookingId, attended: marks[p.bookingId] }));
    if (records.length === 0) { setError('Tick Present or Absent for at least one participant.'); return; }
    await run(async () => { await api(`/api/events/${selected.eventId}/attendance`, { method: 'PUT', body: { records } }); await openParticipants(selected); }, 'Attendance saved.');
  }

  if (!events) return error ? <Alert>{error}</Alert> : <Loading />;
  const published = events.filter((e) => e.status === 'published');
  const booked = events.filter((e) => e.status === 'published' || e.status === 'completed').reduce((s, e) => s + e.confirmedBookings, 0);
  const maxDay = Math.max(1, ...(stats?.bookingsPerDay.map((d) => d.confirmed) ?? [1]));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={isAdmin ? 'All events' : 'My events'} value={events.length} />
        <Stat label="Published" value={published.length} />
        <Stat label="Confirmed bookings" value={booked} />
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="flex justify-between"><h2>{isAdmin ? 'All events' : 'Your events'}</h2>
        <button className="btn-primary" onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(emptyForm); }}>{showForm ? 'Close form' : 'New event'}</button></div>

      {showForm && (
        <form onSubmit={submit} className="card grid gap-4 md:grid-cols-2">
          <h2 className="md:col-span-2">{editingId === null ? 'Create event' : `Edit event #${editingId}`}</h2>
          <div className="md:col-span-2"><label className="label" htmlFor="t">Title</label><input id="t" required minLength={3} className="input" value={form.title} onChange={set('title')} /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="d">Description</label><textarea id="d" rows={3} className="input" value={form.description} onChange={set('description')} /></div>
          <div><label className="label" htmlFor="c">Category</label><select id="c" required className="input" value={form.categoryId} onChange={set('categoryId')}><option value="">Select...</option>{categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.path.replace(/ > /g, ' › ')}</option>)}</select></div>
          <div><label className="label" htmlFor="v">Venue</label><select id="v" required className="input" value={form.venueId} onChange={set('venueId')}><option value="">Select...</option>{venues.map((v) => <option key={v.venueId} value={v.venueId}>{v.name} (max {v.capacity})</option>)}</select></div>
          <div><label className="label" htmlFor="s">Starts</label><input id="s" type="datetime-local" required className="input" value={form.start} onChange={set('start')} /></div>
          <div><label className="label" htmlFor="e">Ends</label><input id="e" type="datetime-local" required className="input" value={form.end} onChange={set('end')} /></div>
          <div><label className="label" htmlFor="cap">Capacity</label><input id="cap" type="number" min={1} required className="input" value={form.capacity} onChange={set('capacity')} /></div>
          {editingId === null && <div><label className="label" htmlFor="st">Status</label><select id="st" className="input" value={form.status} onChange={set('status')}><option value="draft">Draft (hidden)</option><option value="published">Publish now</option></select></div>}
          <div className="md:col-span-2"><button className="btn-primary">{editingId === null ? 'Create event' : 'Save changes'}</button></div>
        </form>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Event</th><th className="th">When</th>{isAdmin && <th className="th">Organizer</th>}<th className="th">Status</th><th className="th">Booked</th><th className="th">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {events.map((ev) => (
              <tr key={ev.eventId} className={selected?.eventId === ev.eventId ? 'bg-brand-light/40' : ''}>
                <td className="td font-medium"><Link className="hover:underline" href={`/events/${ev.eventId}`}>{ev.title}</Link></td>
                <td className="td whitespace-nowrap">{fmtDateTime(ev.startTime)}</td>
                {isAdmin && <td className="td">{ev.organizerName}</td>}
                <td className="td"><StatusBadge status={ev.status} /></td>
                <td className="td">{ev.confirmedBookings}/{ev.capacity}</td>
                <td className="td"><div className="flex flex-wrap gap-1">
                  {(ev.status === 'draft' || ev.status === 'published') && <button className="btn-secondary btn-sm" onClick={() => startEdit(ev)}>Edit</button>}
                  {ev.status === 'draft' && <button className="btn-primary btn-sm" onClick={() => run(() => api(`/api/events/${ev.eventId}/status`, { method: 'POST', body: { status: 'published' } }), 'Event published.')}>Publish</button>}
                  {ev.status === 'published' && <button className="btn-danger btn-sm" onClick={() => { if (confirm('Cancel this event and all its bookings?')) run(() => api(`/api/events/${ev.eventId}/status`, { method: 'POST', body: { status: 'cancelled' } }), 'Event cancelled; bookings were cancelled too.'); }}>Cancel</button>}
                  {ev.status === 'draft' && <button className="btn-secondary btn-sm" onClick={() => { if (confirm('Delete this draft?')) run(() => api(`/api/events/${ev.eventId}`, { method: 'DELETE' }), 'Draft deleted.'); }}>Delete</button>}
                  {(ev.status === 'published' || ev.status === 'completed') && <button className="btn-secondary btn-sm" onClick={() => openParticipants(ev)}>Participants</button>}
                </div></td>
              </tr>
            ))}
            {events.length === 0 && <tr><td className="td text-center text-slate-500" colSpan={6}>No events yet. Create the first one.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && (
        <section className="card space-y-4">
          <div className="flex items-center justify-between"><h2>{selected.title}: participants and statistics</h2><button className="btn-secondary btn-sm" onClick={() => setSelected(null)}>Close</button></div>
          {stats && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label="Seats filled" value={`${stats.fillPercent}%`} hint={`${selected.confirmedBookings} of ${selected.capacity}`} />
              <Stat label="Attendance rate" value={`${stats.attendancePercent}%`} />
              <Stat label="Cancelled bookings" value={stats.cancelledBookings} />
              <Stat label="Average rating" value={selected.avgRating ?? '-'} hint={`${selected.ratingCount} rating(s)`} />
            </div>
          )}
          {stats && stats.bookingsPerDay.length > 0 && (
            <div><p className="mb-2 text-sm font-medium">Bookings per day</p>
              <div className="flex h-24 items-end gap-1">{stats.bookingsPerDay.map((d) => <div key={d.day} title={`${d.day}: ${d.confirmed}`} className="flex-1 rounded-t bg-brand" style={{ height: `${(100 * d.confirmed) / maxDay}%`, minHeight: 4 }} />)}</div></div>
          )}
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Student</th><th className="th">Email</th><th className="th">Booked</th><th className="th">Attendance</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {participants.map((p) => (
                <tr key={p.bookingId}>
                  <td className="td font-medium">{p.studentName}</td><td className="td">{p.studentEmail}</td><td className="td">{fmtDateTime(p.bookedAt)}</td>
                  <td className="td"><div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-1"><input type="radio" name={`a${p.bookingId}`} checked={marks[p.bookingId] === true} onChange={() => setMarks({ ...marks, [p.bookingId]: true })} /> Present</label>
                    <label className="flex items-center gap-1"><input type="radio" name={`a${p.bookingId}`} checked={marks[p.bookingId] === false} onChange={() => setMarks({ ...marks, [p.bookingId]: false })} /> Absent</label>
                  </div></td>
                </tr>
              ))}
              {participants.length === 0 && <tr><td className="td text-center text-slate-500" colSpan={4}>No confirmed participants.</td></tr>}
            </tbody>
          </table>
          {participants.length > 0 && <button className="btn-primary" onClick={saveAttendance}>Save attendance</button>}
        </section>
      )}
    </div>
  );
}
