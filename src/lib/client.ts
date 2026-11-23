'use client';
import { useEffect, useState } from 'react';

/** fetch() wrapper for our JSON API: throws Error(message) when the server answers with an error. */
export async function api<T = any>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.details) ? ': ' + data.details.map((d: any) => d.message).join(', ') : '';
    throw new Error((data.error ?? 'Request failed') + detail);
  }
  return data as T;
}

export interface Me {
  userId: number;
  fullName: string;
  email: string;
  role: 'student' | 'organizer' | 'admin';
}

export function useMe(): { me: Me | null; loading: boolean } {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{ user: Me | null }>('/api/auth/me')
      .then((d) => setMe(d.user))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);
  return { me, loading };
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** ISO string -> value for <input type="datetime-local"> in the browser's time zone */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
