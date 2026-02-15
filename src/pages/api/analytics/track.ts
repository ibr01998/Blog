
import type { APIRoute } from 'astro';
import { db, AnalyticsView, AnalyticsClick, eq } from 'astro:db';

export const POST: APIRoute = async ({ request, clientAddress }) => {
    try {
        const body = await request.json();
        const { type, slug, viewId, link } = body;
        const userAgent = request.headers.get('user-agent') || 'unknown';

        if (!slug) {
            return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
        }

        // 1. New Page View
        if (type === 'view') {
            const id = crypto.randomUUID();
            let country = request.headers.get('x-vercel-ip-country');
            if (import.meta.env.DEV && !country) country = 'Belgium (Local)';
            country = country || 'Unknown';
            // client-side script should send referrer, fallback to header
            const source = body.referrer || request.headers.get('referer') || 'Direct';
            const visitorId = body.visitorId || 'anonymous';

            await db.insert(AnalyticsView).values({
                id,
                slug,
                timestamp: new Date(),
                source: source.substring(0, 100), // Limit length
                userAgent,
                country,
                visitorId
            });
            return new Response(JSON.stringify({ viewId: id }), { status: 200 });
        }

        // 2. Heartbeat (Time Tracking)
        if (type === 'heartbeat') {
            if (!viewId) return new Response(JSON.stringify({ error: 'Missing viewId' }), { status: 400 });

            const views = await db.select().from(AnalyticsView).where(eq(AnalyticsView.id, viewId));
            if (views.length > 0) {
                const currentDuration = views[0].duration || 0;
                await db.update(AnalyticsView)
                    .set({ duration: currentDuration + 5 }) // Assume 5s heartbeat interval
                    .where(eq(AnalyticsView.id, viewId));
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        // 3. Link Click
        if (type === 'click') {
            if (!link) return new Response(JSON.stringify({ error: 'Missing link' }), { status: 400 });

            await db.insert(AnalyticsClick).values({
                id: crypto.randomUUID(),
                slug,
                link,
                timestamp: new Date(),
                type: link.includes('/go/') ? 'affiliate' : 'external'
            });
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400 });

    } catch (e) {
        console.error('Analytics Error:', e);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }
}
