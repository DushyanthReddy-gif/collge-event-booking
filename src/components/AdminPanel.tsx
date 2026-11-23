'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime } from '@/lib/client';
import { Alert, Loading, Stat, StatusBadge } from '@/components/ui';
import EventManager from '@/components/EventManager';
import type { BookingRow } from '@/lib/bookings/service';

type Tab = 'overview' | 'events' | 'users' | 'venues' | 'categories' | 'bookings';
const TABS: Tab[] = ['overview', 'events', 'users', 'venues', 'categories', 'bookings'];

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="space-y-6">
      <h1>Administration</h1>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-slate-300">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-t px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'bg-white text-brand-dark shadow-[0_2px_0_0_#0b6e6a_inset]' : 'text-slate-600 hover:bg-white/60'}`}>{t}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'events' && <EventManager isAdmin />}
      {tab === 'users' && <Users />}
      {tab === 'venues' && <Venues />}
      {tab === 'categories' && <Categories />}
      {tab === 'bookings' && <Bookings />}
    </div>
  );
}

function Overview() {
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => { api('/api/admin/stats').then(setS).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  if (!s) return error ? <Alert>{error}</Alert> : <Loading />;
  const count = (rows: { status?: string; role?: string; n: number }[], key: string) => rows.find((r) => (r.status ?? r.role) === key)?.n ?? 0;
  const max = Math.max(1, ...s.bookingsPerDay.map((d: any) => d.n));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Students" value={count(s.usersByRole, 'student')} hint={`${count(s.usersByRole, 'organizer')} organizers, ${count(s.usersByRole, 'admin')} admin`} />
        <Stat label="Events" value={s.eventsByStatus.reduce((a: number, r: any) => a + r.n, 0)} hint={`${count(s.eventsByStatus, 'published')} published, ${count(s.eventsByStatus, 'completed')} completed`} />
        <Stat label="Confirmed bookings" value={count(s.bookingsByStatus, 'confirmed')} hint={`${count(s.bookingsByStatus, 'cancelled')} cancelled`} />
        <Stat label="Attendance / rating" value={`${s.attendancePercent ?? '-'}% / ${s.averageRating ?? '-'}`} hint={`${s.venues} venues, ${s.categories} categories`} />
      </div>
      {error && <Alert>{error}</Alert>}{notice && <Alert kind="success">{notice}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card"><h2 className="mb-3">Most popular events</h2>
          <table className="w-full"><thead><tr><th className="th">#</th><th className="th">Event</th><th className="th">Booked</th><th className="th">Fill</th></tr></thead>
            <tbody>{s.popularEvents.map((e: any) => <tr key={e.title} className="border-t border-slate-100"><td className="td">{e.rank}</td><td className="td">{e.title}</td><td className="td">{e.bookings}/{e.capacity}</td><td className="td">{e.fill}%</td></tr>)}</tbody></table></section>
        <section className="card"><h2 className="mb-3">Bookings in the last 14 days</h2>
          <div className="flex h-32 items-end gap-1">{s.bookingsPerDay.map((d: any) => <div key={d.day} title={`${d.day}: ${d.n}`} className="flex-1 rounded-t bg-brand" style={{ height: `${(100 * d.n) / max}%`, minHeight: 3 }} />)}</div>
          <h2 className="mb-2 mt-6">By category</h2>
          <ul className="space-y-1 text-sm">{s.categoryBreakdown.map((c: any) => <li key={c.category} className="flex justify-between"><span>{c.category}</span><span className="text-slate-600">{c.events} events, {c.bookings} bookings</span></li>)}</ul></section>
      </div>
      <button className="btn-secondary" onClick={async () => { try { const r = await api<{ updated: number }>('/api/admin/complete-events', { method: 'POST' }); setNotice(`Stored procedure complete_finished_events() updated ${r.updated} event(s).`); load(); } catch (e) { setError((e as Error).message); } }}>Mark finished events as completed</button>
    </div>
  );
}

function Users() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { api<{ users: any[] }>('/api/admin/users').then((d) => setRows(d.users)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  async function patch(id: number, body: object) { setError(''); try { await api(`/api/admin/users/${id}`, { method: 'PATCH', body }); load(); } catch (e) { setError((e as Error).message); } }
  if (!rows) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <div className="space-y-3">{error && <Alert>{error}</Alert>}
      <div className="card overflow-x-auto p-0"><table className="w-full">
        <thead className="border-b bg-slate-50"><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Department</th><th className="th">Role</th><th className="th">Active</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((u) => (
          <tr key={u.userId}><td className="td font-medium">{u.fullName}</td><td className="td">{u.email}</td><td className="td">{u.department ?? '-'}</td>
            <td className="td"><select aria-label={`Role of ${u.fullName}`} className="input w-32 py-1" value={u.role} onChange={(e) => patch(u.userId, { role: e.target.value })}><option>student</option><option>organizer</option><option>admin</option></select></td>
            <td className="td"><button className={u.isActive ? 'btn-secondary btn-sm' : 'btn-danger btn-sm'} onClick={() => patch(u.userId, { isActive: !u.isActive })}>{u.isActive ? 'Deactivate' : 'Activate'}</button></td></tr>))}</tbody></table></div></div>
  );
}

function Venues() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [form, setForm] = useState({ name: '', location: '', capacity: '50' });
  const [error, setError] = useState('');
  const load = useCallback(() => { api<{ venues: any[] }>('/api/admin/venues').then((d) => setRows(d.venues)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  async function run(fn: () => Promise<unknown>) { setError(''); try { await fn(); load(); } catch (e) { setError((e as Error).message); } }
  if (!rows) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <div className="space-y-4">{error && <Alert>{error}</Alert>}
      <form className="card grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/api/admin/venues', { method: 'POST', body: { name: form.name, location: form.location, capacity: Number(form.capacity) } }); setForm({ name: '', location: '', capacity: '50' }); }); }}>
        <div><label className="label" htmlFor="vn">Name</label><input id="vn" required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="vl">Location</label><input id="vl" className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
        <div><label className="label" htmlFor="vc">Capacity</label><input id="vc" type="number" min={1} required className="input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
        <div className="flex items-end"><button className="btn-primary w-full">Add venue</button></div></form>
      <div className="card overflow-x-auto p-0"><table className="w-full">
        <thead className="border-b bg-slate-50"><tr><th className="th">Venue</th><th className="th">Location</th><th className="th">Capacity</th><th className="th">Active</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((v) => (
          <tr key={v.venueId}><td className="td font-medium">{v.name}</td><td className="td">{v.location}</td>
            <td className="td"><input aria-label={`Capacity of ${v.name}`} type="number" min={1} className="input w-24 py-1" defaultValue={v.capacity}
              onBlur={(e) => { const c = Number(e.target.value); if (c !== v.capacity) run(() => api(`/api/admin/venues/${v.venueId}`, { method: 'PUT', body: { name: v.name, location: v.location, capacity: c, isActive: v.isActive } })); }} /></td>
            <td className="td"><input aria-label={`${v.name} active`} type="checkbox" checked={v.isActive} onChange={(e) => run(() => api(`/api/admin/venues/${v.venueId}`, { method: 'PUT', body: { name: v.name, location: v.location, capacity: v.capacity, isActive: e.target.checked } }))} /></td>
            <td className="td text-right"><button className="btn-secondary btn-sm" onClick={() => { if (confirm(`Delete ${v.name}?`)) run(() => api(`/api/admin/venues/${v.venueId}`, { method: 'DELETE' })); }}>Delete</button></td></tr>))}</tbody></table></div>
      <p className="text-xs text-slate-500">Deleting a venue that has events is refused by the foreign key (ON DELETE RESTRICT). Lowering a capacity below a planned event is refused by a trigger.</p></div>
  );
}

function Categories() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [form, setForm] = useState({ name: '', description: '', parent: '' });
  const [error, setError] = useState('');
  const load = useCallback(() => { api<{ categories: any[] }>('/api/meta').then((d) => setRows(d.categories)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  async function run(fn: () => Promise<unknown>) { setError(''); try { await fn(); load(); } catch (e) { setError((e as Error).message); } }
  if (!rows) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <div className="space-y-4">{error && <Alert>{error}</Alert>}
      <form className="card grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/api/admin/categories', { method: 'POST', body: { name: form.name, description: form.description, parentCategoryId: form.parent ? Number(form.parent) : null } }); setForm({ name: '', description: '', parent: '' }); }); }}>
        <div><label className="label" htmlFor="cn">Name</label><input id="cn" required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="cd">Description</label><input id="cd" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><label className="label" htmlFor="cp">Parent</label><select id="cp" className="input" value={form.parent} onChange={(e) => setForm({ ...form, parent: e.target.value })}><option value="">(top level)</option>{rows.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.path}</option>)}</select></div>
        <div className="flex items-end"><button className="btn-primary w-full">Add category</button></div></form>
      <div className="card overflow-x-auto p-0"><table className="w-full">
        <thead className="border-b bg-slate-50"><tr><th className="th">Category path (recursive view)</th><th className="th">Description</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((c) => (
          <tr key={c.categoryId}><td className="td font-medium" style={{ paddingLeft: 12 + (c.depth - 1) * 20 }}>{c.name}</td><td className="td">{c.description}</td>
            <td className="td text-right"><button className="btn-secondary btn-sm" onClick={() => { if (confirm(`Delete ${c.name}?`)) run(() => api(`/api/admin/categories/${c.categoryId}`, { method: 'DELETE' })); }}>Delete</button></td></tr>))}</tbody></table></div></div>
  );
}

function Bookings() {
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<{ bookings: BookingRow[] }>('/api/bookings').then((d) => setRows(d.bookings)).catch((e) => setError(e.message)); }, []);
  if (!rows) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <div className="card overflow-x-auto p-0"><table className="w-full">
      <thead className="border-b bg-slate-50"><tr><th className="th">Student</th><th className="th">Event</th><th className="th">Booked</th><th className="th">Status</th><th className="th">Attendance</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map((b) => (
        <tr key={b.bookingId}><td className="td font-medium">{b.studentName}</td><td className="td">{b.eventTitle}</td><td className="td whitespace-nowrap">{fmtDateTime(b.bookedAt)}</td>
          <td className="td"><StatusBadge status={b.bookingStatus} /></td><td className="td">{b.attended === null ? '-' : b.attended ? 'Present' : 'Absent'}</td></tr>))}</tbody></table></div>
  );
}
