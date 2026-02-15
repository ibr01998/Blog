export const prerender = false;
import { db, AnalyticsView, AnalyticsClick, Post, eq, desc, sql } from 'astro:db';

export async function GET() {
    try {
        const views = await db.select().from(AnalyticsView);
        const clicks = await db.select().from(AnalyticsClick);
        const posts = await db.select().from(Post);

        // --- Helpers ---
        const groupByDate = (data: any[]) => {
            const grouped = data.reduce((acc, curr) => {
                const date = new Date(curr.timestamp).toISOString().split('T')[0];
                acc[date] = (acc[date] || 0) + 1;
                return acc;
            }, {});
            return grouped;
        };

        const groupByField = (data: any[], field: string) => {
            return data.reduce((acc, curr) => {
                const val = curr[field] || 'Unknown';
                acc[val] = (acc[val] || 0) + 1;
                return acc;
            }, {});
        }

        // --- Aggregations ---

        // 1. General Stats
        const totalViews = views.length;
        const totalClicks = clicks.length;
        // Calculate avg time (simple average of duration column)
        const totalDuration = views.reduce((acc, curr) => acc + (curr.duration || 0), 0);
        const avgTime = totalViews > 0 ? Math.round(totalDuration / totalViews) : 0;

        // Format Avg Time (MM:SS)
        const minutes = Math.floor(avgTime / 60);
        const seconds = avgTime % 60;
        const avgTimeStr = `${minutes}m ${seconds}s`;

        // Format Total Time (HH:MM:SS)
        const totalHours = Math.floor(totalDuration / 3600);
        const totalMinutes = Math.floor((totalDuration % 3600) / 60);
        const totalTimeStr = `${totalHours}h ${totalMinutes}m`;


        // 2. Charts Data (Last 7 Days)
        const viewsByDate = groupByDate(views);
        const clicksByDate = groupByDate(clicks);

        const uniqueViewsByDate = views.reduce((acc, curr) => {
            const date = new Date(curr.timestamp).toISOString().split('T')[0];
            if (!acc[date]) acc[date] = new Set();
            acc[date].add(curr.visitorId || curr.userAgent);
            return acc;
        }, {});

        const labels = [];
        const viewData = [];
        const uniqueViewData = [];
        const clickData = [];

        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            labels.push(d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric' }));
            viewData.push(viewsByDate[dateStr] || 0);
            clickData.push(clicksByDate[dateStr] || 0);
            uniqueViewData.push(uniqueViewsByDate[dateStr] ? uniqueViewsByDate[dateStr].size : 0);
        }

        // 3. Device Breakdown
        const deviceData = views.reduce((acc, curr) => {
            const ua = (curr.userAgent || '').toLowerCase();
            if (ua.includes('mobile')) acc.Mobile++;
            else acc.Desktop++;
            return acc;
        }, { Desktop: 0, Mobile: 0 });

        // 4. Top Referrers
        const referrerData = groupByField(views, 'source');
        const topReferrers = Object.entries(referrerData)
            .sort(([, a]: any, [, b]: any) => b - a)
            .slice(0, 5);

        // 5. Top Countries
        const countryData = groupByField(views, 'country');
        const topCountries = Object.entries(countryData)
            .sort(([, a]: any, [, b]: any) => b - a)
            .slice(0, 10);

        // 6. Top Articles
        const topArticles = posts.map(p => {
            const pViews = views.filter(v => v.slug === p.slug).length;
            const pClicks = clicks.filter(c => c.slug === p.slug).length;
            const ctr = pViews > 0 ? ((pClicks / pViews) * 100).toFixed(1) : '0.0';
            return { title: p.title, views: pViews, clicks: pClicks, ctr };
        }).sort((a, b) => b.views - a.views).slice(0, 5);


        return new Response(JSON.stringify({
            totalViews,
            totalClicks,
            avgTimeStr,
            totalTimeStr,
            chartData: {
                labels,
                views: viewData,
                uniqueViews: uniqueViewData,
                clicks: clickData,
                device: [deviceData.Desktop, deviceData.Mobile],
                referrerLabels: topReferrers.map(([k]) => k),
                referrerValues: topReferrers.map(([, v]) => v),
                countryLabels: topCountries.map(([k]) => k),
                countryValues: topCountries.map(([, v]) => v)
            },
            topArticles,
            topCountries // Sending as array of [name, count]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Error fetching analytics stats:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch stats' }), { status: 500 });
    }
}
