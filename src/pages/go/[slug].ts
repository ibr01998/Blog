import type { APIRoute } from 'astro';
import { db, Platform, eq } from 'astro:db';
import { affiliatePrograms as affiliates, getAffiliateUrl } from '../../data/affiliates';
import { query } from '../../lib/db/postgres';

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

    // 3. Check Amazon products by ASIN-based slug (e.g. /go/amazon-B0XXXXXXXXX)
    if (normSlug.startsWith('amazon-')) {
        const asin = normSlug.replace('amazon-', '').toUpperCase();
        try {
            const rows = await query<{ affiliate_url: string }>(
                'SELECT affiliate_url FROM amazon_products WHERE UPPER(asin) = $1 AND is_available = true LIMIT 1',
                [asin]
            );
            if (rows.length > 0 && rows[0].affiliate_url) {
                return redirect(rows[0].affiliate_url, 307);
            }
        } catch {
            // Postgres not available — fall through
        }
    }

    // 4. Check Bol.com products by EAN-based slug (e.g. /go/bol-5412345678901)
    if (normSlug.startsWith('bol-')) {
        const ean = normSlug.replace('bol-', '');
        try {
            const rows = await query<{ affiliate_url: string }>(
                'SELECT affiliate_url FROM bol_products WHERE ean = $1 AND is_available = true LIMIT 1',
                [ean]
            );
            if (rows.length > 0 && rows[0].affiliate_url) {
                return redirect(rows[0].affiliate_url, 307);
            }
        } catch {
            // Postgres not available — fall through
        }
    }

    return new Response('Link not found', { status: 404 });
};
