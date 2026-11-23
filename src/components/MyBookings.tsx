'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDateTime } from '@/lib/client';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import type { BookingRow } from '@/lib/bookings/service';

export default function MyBookings() {
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { setRows((await api<{ bookings: BookingRow[] }>('/api/bookings')).bookings); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function cancel(eventId: number) {
    setBusyId(eventId); setError('');
    try { await api(`/api/events/${eventId}/cancel`, { method: 'POST' }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusyId(null); }
  }

  if (!rows) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <div className="space-y-4">
      <h1>My bookings</h1>
      {error && <Alert>{error}</Alert>}
      {rows.length === 0 ? (
        <p className="card text-center text-slate-600">You have no bookings yet. <Link className="text-brand underline" href="/events">Browse events</Link></p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Event</th><th className="th">When</th><th className="th">Venue</th><th className="th">Booking</th><th className="th">Attendance</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((b) => {
                const upcoming = new Date(b.startTime) > new Date() && b.eventStatus === 'published';
                return (
                  <tr key={b.bookingId}>
                    <td className="td font-medium"><Link className="hover:underline" href={`/events/${b.eventId}`}>{b.eventTitle}</Link></td>
                    <td className="td">{fmtDateTime(b.startTime)}</td>
                    <td className="td">{b.venueName}</td>
                    <td className="td"><StatusBadge status={b.bookingStatus} />{b.eventStatus === 'cancelled' && <span className="ml-1 text-xs text-red-700">(event cancelled)</span>}</td>
                    <td className="td">{b.attended === null ? '-' : b.attended ? 'Present' : 'Absent'}</td>
                    <td className="td text-right">
                      {b.bookingStatus === 'confirmed' && upcoming && <button className="btn-secondary btn-sm" disabled={busyId === b.eventId} onClick={() => cancel(b.eventId)}>Cancel</button>}
                      {b.attended && !b.hasFeedback && <Link className="btn-primary btn-sm" href={`/events/${b.eventId}`}>Give feedback</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
