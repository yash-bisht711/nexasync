import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-only-change-this-secret-before-deploying-123456');

async function hasValidSession(req: NextRequest) {
  const token = req.cookies.get('collabspace_session')?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret);
    return Boolean(payload.sub);
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = await hasValidSession(req);
  const isAppRoute = pathname.startsWith('/app');
  const isAuthRoute = pathname === '/login' || pathname === '/register';

  if (isAppRoute && !authed) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (isAuthRoute && authed) {
    return NextResponse.redirect(new URL('/app', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/login', '/register'],
};
