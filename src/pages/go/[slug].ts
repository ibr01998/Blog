import type { APIRoute } from 'astro';
import { db, Platform, eq } from 'astro:db';
import { affiliatePrograms as affiliates } from '../../data/affiliates';

export const GET: APIRoute = async ({ params, redirect }) => {
    const { slug } = params;

    if (!slug) return new Response('Not found', { status: 404 });

    // 1. Check DB Platforms
    const platform = await db.select().from(Platform).where(eq(Platform.slug, slug)).get();
    if (platform && platform.affiliateLink) {
        return redirect(platform.affiliateLink, 307);
    }

    // 2. Check Static Affiliates (fallback)
    const affiliate = affiliates.find(a => a.slug === slug);
    if (affiliate) {
        return redirect(affiliate.url, 307);
    }

    return new Response('Link not found', { status: 404 });
};
