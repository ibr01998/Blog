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

    // Only protect /dashboard routes (except /dashboard/login and API routes)
    if (!pathname.startsWith('/dashboard')) {
        return next();
    }

    // Allow the login page and login API through
    if (pathname === '/dashboard/login' || pathname === '/api/auth/login') {
        return next();
    }

    // Check for session cookie
    const session = context.cookies.get(COOKIE_NAME);

    if (!session || session.value !== SESSION_TOKEN) {
        // Redirect to login
        return context.redirect('/dashboard/login');
    }

    return next();
});
