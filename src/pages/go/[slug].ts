import type { APIRoute } from 'astro';
import { db, Platform, eq } from 'astro:db';
import { affiliatePrograms as affiliates, getAffiliateUrl } from '../../data/affiliates';

export const GET: APIRoute = async ({ params, redirect }) => {
    const { slug } = params;

    if (!slug) return new Response('Not found', { status: 404 });

    // Normalise to lowercase so /go/Bybit and /go/bybit both work
    const normSlug = slug.toLowerCase();

    // 1. Check DB Platforms
    const platform = await db.select().from(Platform).where(eq(Platform.slug, normSlug)).get();
    if (platform && platform.affiliateLink) {
        return redirect(platform.affiliateLink, 307);
    }

    // 2. Check Static Affiliates (fallback — uses env var, then hardcoded url)
    const affiliate = affiliates.find(a => a.slug === normSlug);
    if (affiliate) {
        const url = getAffiliateUrl(affiliate.id);
        if (url) {
            return redirect(url, 307);
        }
    }

    return new Response('Link not found', { status: 404 });
};
