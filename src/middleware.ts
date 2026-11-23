import { NextResponse, type NextRequest } from 'next/server';

// First, cheap UI gate: pages that need a login redirect to /login when there is no session cookie.
// The REAL checks (valid signature, active user, role) happen server-side in requirePage()/requireUser().
export function middleware(req: NextRequest) {
  if (!req.cookies.get('ceb_session')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*', '/my-bookings/:path*', '/organizer/:path*', '/admin/:path*'] };
