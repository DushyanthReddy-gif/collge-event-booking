'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Alert, EventCard, Loading } from '@/components/ui';
import type { EventSummary } from '@/lib/events/service';

interface Category { categoryId: number; name: string; path: string }
interface SearchResponse { mode: string; embeddingProvider?: string; results: EventSummary[] }

export default function EventsPage() {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'keyword' | 'semantic'>('keyword');
  const [categoryId, setCategoryId] = useState('');
  const [when, setWhen] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [categories, setCategories] = useState<Category[]>([]);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const search = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ q, mode, when, limit: '24' });
      if (categoryId) params.set('categoryId', categoryId);
      setData(await api<SearchResponse>(`/api/search?${params}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, mode, when, categoryId]);

  useEffect(() => {
    api<{ categories: Category[] }>('/api/meta').then((d) => setCategories(d.categories)).catch(() => undefined);
  }, []);
  // reload when a filter (not the text box) changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { search(); }, [mode, when, categoryId]);

  return (
    <div className="space-y-6">
      <h1>Events</h1>
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="card space-y-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="flex-1">
            <label className="label" htmlFor="q">Search events</label>
            <input id="q" className="input" placeholder="e.g. robotics and AI workshop" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="md:w-48">
            <label className="label" htmlFor="cat">Category</label>
            <select id="cat" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.path.replace(/ > /g, ' › ')}</option>)}
            </select>
          </div>
          <div className="md:w-36">
            <label className="label" htmlFor="when">When</label>
            <select id="when" className="input" value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
              <option value="upcoming">Upcoming</option><option value="past">Past</option><option value="all">All</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <fieldset className="flex items-center gap-4 text-sm">
            <legend className="sr-only">Search mode</legend>
            <span className="font-medium text-slate-700">Search mode</span>
            <label className="flex items-center gap-1.5"><input type="radio" name="mode" checked={mode === 'keyword'} onChange={() => setMode('keyword')} /> Keyword</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="mode" checked={mode === 'semantic'} onChange={() => setMode('semantic')} /> Semantic (by meaning)</label>
          </fieldset>
          <button className="btn-primary" type="submit">Search</button>
        </div>
        {mode === 'semantic' && <p className="text-xs text-slate-500">Semantic search embeds your text into a vector and finds the closest events with pgvector, even when the exact words do not appear.</p>}
      </form>

      {error && <Alert>{error}</Alert>}
      {loading ? <Loading /> : data && (
        data.results.length === 0 ? (
          <p className="card text-center text-slate-600">No events match. Try different words or switch to semantic search.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">{data.results.length} event(s){data.mode === 'semantic' ? ` ranked by similarity (${data.embeddingProvider} embeddings)` : ''}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.results.map((e) => <EventCard key={e.eventId} e={e} />)}</div>
          </>
        )
      )}
    </div>
  );
}
