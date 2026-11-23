'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Alert } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ redirectTo: string }>('/api/auth/login', { method: 'POST', body: { email, password } });
      router.push(res.redirectTo);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={submit} className="card space-y-4">
        <h1>Log in</h1>
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
        <div><label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
        <p className="text-sm text-slate-600">New student? <Link className="font-medium text-brand underline" href="/register">Create an account</Link></p>
      </form>
      <div className="card mt-4 text-sm text-slate-600">
        <p className="font-medium text-ink">Demo accounts (password <code>Password@123</code>)</p>
        <ul className="mt-2 space-y-1">
          <li>Student: aarav.sharma@college.edu</li>
          <li>Organizer: rajesh.kumar@college.edu</li>
          <li>Admin: admin@college.edu</li>
        </ul>
      </div>
    </div>
  );
}
