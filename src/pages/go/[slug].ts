// src/pages/go/[slug].ts
import type { APIRoute } from 'astro';
import { db, Platform, eq } from 'astro:db';
import { getAffiliateUrl } from '../../data/affiliates';

export const GET: APIRoute = async ({ params, redirect }) => {
    const { slug } = params;

    if (!slug) return new Response('Not found', { status: 404 });

    try {
        console.log(`[Redirect] Checking slug: ${slug}`);

        // 1. Check DB Platforms (Dynamic)
        const platform = await db.select().from(Platform).where(eq(Platform.slug, slug)).get();
        console.log(`[Redirect] DB Platform found:`, platform);

        if (platform && platform.affiliateLink) {
            console.log(`[Redirect] Redirecting to DB link: ${platform.affiliateLink}`);
            return redirect(platform.affiliateLink, 307);
        }

        // 2. Check Static Affiliates (Fallback with Env Var support)
        const staticUrl = getAffiliateUrl(slug);
        console.log(`[Redirect] Static URL found:`, staticUrl);

        if (staticUrl) {
            console.log(`[Redirect] Redirecting to Static link: ${staticUrl}`);
            return redirect(staticUrl, 307);
        }

    } catch (error) {
        console.error(`Error Redirecting ${slug}:`, error);
        return new Response(`Internal Server Error: ${error instanceof Error ? error.message : String(error)}`, { status: 500 });
    }

    console.log(`[Redirect] No match found for ${slug}`);
    return new Response(`Link not found for: ${slug}`, { status: 404 });
};
