// src/pages/go/[slug].ts
import type { APIRoute } from 'astro';
import { db, Platform, eq } from 'astro:db';
import { getAffiliateUrl } from '../../data/affiliates';

export const GET: APIRoute = async ({ params, redirect }) => {
    const { slug } = params;

    if (!slug) return new Response('Not found', { status: 404 });

    try {
        // 1. Check DB Platforms (Dynamic)
        const platform = await db.select().from(Platform).where(eq(Platform.slug, slug)).get();
        if (platform && platform.affiliateLink) {
            return redirect(platform.affiliateLink, 307);
        }

        // 2. Check Static Affiliates (Fallback with Env Var support)
        const staticUrl = getAffiliateUrl(slug);
        if (staticUrl) {
            return redirect(staticUrl, 307);
        }

    } catch (error) {
        console.error(`Error Redirecting ${slug}:`, error);
        return new Response('Internal Server Error', { status: 500 });
    }

    return new Response('Link not found', { status: 404 });
};
