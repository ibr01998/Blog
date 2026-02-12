/**
 * Dashboard Login API
 * POST — validates password, sets session cookie
 */
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
    const formData = await request.formData();
    const password = formData.get('password')?.toString();

    const correctPassword = import.meta.env.DASHBOARD_PASSWORD || 'admin';

    if (password === correctPassword) {
        cookies.set('dashboard_session', 'authenticated', {
            path: '/',
            httpOnly: true,
            secure: import.meta.env.PROD,
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
        });
        return redirect('/dashboard', 302);
    }

    // Wrong password — redirect back with error
    return redirect('/dashboard/login?error=1', 302);
};
