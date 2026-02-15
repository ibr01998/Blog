/**
 * Astro Middleware — Dashboard Authentication
 * Protects all /dashboard routes with a simple cookie-based session.
 * Login via /dashboard/login with DASHBOARD_PASSWORD from env.
 */
import { defineMiddleware } from 'astro:middleware';

const COOKIE_NAME = 'dashboard_session';
const SESSION_TOKEN = 'authenticated'; // simple token for v1

export const onRequest = defineMiddleware(async (context, next) => {
    const { pathname } = context.url;

    // Only protect /dashboard routes and /api/admin routes
    const isDashboard = pathname.startsWith('/dashboard');
    const isAdminApi = pathname.startsWith('/api/admin');

    if (!isDashboard && !isAdminApi) {
        return next();
    }

    // Allow the login page and login API through
    if (pathname === '/dashboard/login' || pathname === '/api/auth/login') {
        return next();
    }

    // Allow Vercel Cron requests with valid CRON_SECRET to bypass session auth
    if (isAdminApi && pathname === '/api/admin/run-cycle') {
        const cronSecret = (import.meta as any).env?.CRON_SECRET ?? process.env.CRON_SECRET;
        const authHeader = context.request.headers.get('authorization');
        if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
            return next();
        }
    }

    // Check for session cookie
    const session = context.cookies.get(COOKIE_NAME);

    if (!session || session.value !== SESSION_TOKEN) {
        // API routes return 401 JSON; dashboard routes redirect to login
        if (isAdminApi) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return context.redirect('/dashboard/login');
    }

    return next();
});
