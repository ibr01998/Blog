import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, redirect }) => {
    const { id } = params;

    // Configuration mapping for affiliate links
    // In production, these should be env vars, but we can fallback or map them here
    const redirects: Record<string, string | undefined> = {
        // Example: /go/bitmex -> redirects to env var AFFILIATE_LINK_BITMEX
        'bitmex': import.meta.env.AFFILIATE_LINK_BITMEX || 'https://www.bitmex.com/register/YOUR_CODE',
        'bybit': import.meta.env.AFFILIATE_LINK_BYBIT || 'https://www.bybit.com/register?affiliate_id=YOUR_CODE',
        // Add more here
    };

    const destination = redirects[id || ''];

    if (destination) {
        return redirect(destination, 307); // Temporary redirect to keep link equity on the main domain ideally, or 302
    }

    return new Response(null, {
        status: 404,
        statusText: 'Not found'
    });
};
