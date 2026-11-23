'use client';
import Link from 'next/link';
import type { EventSummary } from '@/lib/events/service';
import { fmtDateTime } from '@/lib/client';

const STATUS_STYLES: Record<string, string> = {
  published: 'bg-emerald-100 text-emerald-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  draft: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-sky-100 text-sky-800',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`chip ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}>{status}</span>;
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const styles = { error: 'border-red-200 bg-red-50 text-red-800', success: 'border-emerald-200 bg-emerald-50 text-emerald-800', info: 'border-sky-200 bg-sky-50 text-sky-800' };
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${styles[kind]}`}>{children}</div>;
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-slate-500" aria-live="polite">{label}</p>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Stars({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-400">No ratings yet</span>;
  return <span className="text-sm text-amber" title={`${value} / 5`}>{'★'.repeat(Math.round(value))}{'☆'.repeat(5 - Math.round(value))} <span className="text-slate-600">{value.toFixed(1)}</span></span>;
}

export function EventCard({ e }: { e: EventSummary }) {
  const soldOut = e.status === 'published' && e.seatsRemaining <= 0;
  return (
    <Link href={`/events/${e.eventId}`} className="card flex flex-col gap-2 transition hover:border-brand">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug">{e.title}</h3>
        {e.similarity != null && <span className="chip shrink-0 bg-brand-light text-brand-dark">{Math.round(e.similarity * 100)}% match</span>}
      </div>
      <p className="text-xs"><span className="chip bg-slate-100 text-slate-700">{e.categoryName}</span></p>
      <p className="text-sm text-slate-600">{fmtDateTime(e.startTime)}</p>
      <p className="text-sm text-slate-600">{e.venueName}</p>
      <div className="mt-auto flex items-center justify-between pt-2">
        <Stars value={e.avgRating} />
        {e.status === 'completed' ? <StatusBadge status="completed" /> : soldOut ? <span className="chip bg-amber-light text-amber">Sold out</span> : <span className="text-xs font-medium text-brand-dark">{e.seatsRemaining} seats left</span>}
      </div>
    </Link>
  );
}
