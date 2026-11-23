'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Alert } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', department: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/register', { method: 'POST', body: { ...form, department: form.department || undefined } });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mx-auto max-w-md space-y-4">
      <h1>Create a student account</h1>
      {error && <Alert>{error}</Alert>}
      <div><label className="label" htmlFor="fullName">Full name</label><input id="fullName" required className="input" value={form.fullName} onChange={set('fullName')} /></div>
      <div><label className="label" htmlFor="email">College email</label><input id="email" type="email" required className="input" value={form.email} onChange={set('email')} /></div>
      <div><label className="label" htmlFor="department">Department (optional)</label><input id="department" className="input" value={form.department} onChange={set('department')} /></div>
      <div><label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" required minLength={8} className="input" value={form.password} onChange={set('password')} autoComplete="new-password" />
        <p className="mt-1 text-xs text-slate-500">At least 8 characters, with a letter and a number.</p></div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating...' : 'Register'}</button>
      <p className="text-sm text-slate-600">Already registered? <Link className="font-medium text-brand underline" href="/login">Log in</Link></p>
    </form>
  );
}
