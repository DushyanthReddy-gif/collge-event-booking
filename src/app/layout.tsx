import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import { getCurrentUser } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'College Event Booking & Management System',
  description: 'Browse, book and manage college events.',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Navbar user={user ? { fullName: user.fullName, role: user.role } : null} />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
