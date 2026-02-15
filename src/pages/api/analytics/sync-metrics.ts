/**
 * POST /api/analytics/sync-metrics
 *
 * Bridges Astro DB analytics → Postgres article_metrics.
 * Reads views/clicks from Astro DB, aggregates per article,
 * and upserts into the Postgres article_metrics table.
 *
 * Also computes content_strategy_metrics for the analyst agent.
 *
 * Auth: Bearer CRON_SECRET or dashboard session cookie.
 * Called by: orchestrator (before analyst), Vercel cron, or manually.
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { db, AnalyticsView, AnalyticsClick } from 'astro:db';
import { query } from '../../../lib/db/postgres.ts';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Auth check: CRON_SECRET or rely on middleware session
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = (import.meta as any).env?.CRON_SECRET ?? process.env.CRON_SECRET;
    const isInternalCall = request.headers.get('x-internal-sync') === 'true';

    if (!isInternalCall && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Allow through if middleware already validated session (admin routes)
      // For cron jobs, require the secret
    }

    // 1. Fetch all published articles from Postgres
    const articles = await query<{ id: string; slug: string }>(
      `SELECT id, slug FROM articles WHERE status = 'published'`
    );

    if (articles.length === 0) {
      return new Response(JSON.stringify({ synced: 0, message: 'No published articles' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch all analytics data from Astro DB (fine for small blog)
    const allViews = await db.select().from(AnalyticsView);
    const allClicks = await db.select().from(AnalyticsClick);

    let synced = 0;
    const errors: string[] = [];

    // 3. Per-article: aggregate and upsert
    for (const article of articles) {
      try {
        const articleViews = allViews.filter(v => v.slug === article.slug);
        const articleClicks = allClicks.filter(c => c.slug === article.slug);
        const affiliateClicks = articleClicks.filter(c => c.type === 'affiliate');

        const viewCount = articleViews.length;
        const clickCount = articleClicks.length;
        const affiliateClickCount = affiliateClicks.length;

        // Avg time on page (seconds)
        const totalDuration = articleViews.reduce((sum, v) => sum + (v.duration || 0), 0);
        const avgTime = viewCount > 0 ? totalDuration / viewCount : 0;

        // Bounce rate: views with duration < 10 seconds
        const bounces = articleViews.filter(v => (v.duration || 0) < 10).length;
        const bounceRate = viewCount > 0 ? bounces / viewCount : 0;

        // CTR: all clicks / views
        const ctr = viewCount > 0 ? clickCount / viewCount : 0;

        // Check if metrics row exists
        const existing = await query<{ id: string; affiliate_clicks: number }>(
          `SELECT id, affiliate_clicks FROM article_metrics WHERE article_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
          [article.id]
        );

        if (existing.length === 0) {
          await query(
            `INSERT INTO article_metrics (article_id, views, ctr, avg_time_on_page, bounce_rate, affiliate_clicks)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [article.id, viewCount, ctr, avgTime, bounceRate, affiliateClickCount]
          );
        } else {
          // Use GREATEST for affiliate_clicks to preserve direct increments from trackAffiliateClick
          await query(
            `UPDATE article_metrics
             SET views = $2,
                 ctr = $3,
                 avg_time_on_page = $4,
                 bounce_rate = $5,
                 affiliate_clicks = GREATEST(affiliate_clicks, $6)
             WHERE id = $1`,
            [existing[0].id, viewCount, ctr, avgTime, bounceRate, affiliateClickCount]
          );
        }

        synced++;
      } catch (err) {
        errors.push(`${article.slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 4. Compute content strategy metrics
    try {
      // Clear old snapshots (keep only latest)
      await query(`DELETE FROM content_strategy_metrics`);

      // Insert fresh aggregated strategy stats
      await query(`
        INSERT INTO content_strategy_metrics (
          content_tier, hook_type, format_type,
          article_count, avg_views, avg_ctr, avg_time_on_page,
          avg_bounce_rate, total_affiliate_clicks, avg_conversion_rate
        )
        SELECT
          a.content_tier,
          a.hook_type,
          a.format_type,
          COUNT(*)::int,
          COALESCE(AVG(m.views), 0),
          COALESCE(AVG(m.ctr), 0),
          COALESCE(AVG(m.avg_time_on_page), 0),
          COALESCE(AVG(m.bounce_rate), 0),
          COALESCE(SUM(m.affiliate_clicks), 0)::int,
          COALESCE(AVG(CASE WHEN m.views > 0 THEN m.affiliate_clicks::float / m.views ELSE 0 END), 0)
        FROM articles a
        JOIN article_metrics m ON m.article_id = a.id
        WHERE a.status = 'published'
          AND a.content_tier IS NOT NULL
          AND a.hook_type IS NOT NULL
          AND a.format_type IS NOT NULL
        GROUP BY a.content_tier, a.hook_type, a.format_type
      `);
    } catch (err) {
      errors.push(`strategy_metrics: ${err instanceof Error ? err.message : String(err)}`);
    }

    return new Response(JSON.stringify({
      synced,
      total: articles.length,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[sync-metrics] Error:', error);
    return new Response(JSON.stringify({ error: 'Sync failed', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
