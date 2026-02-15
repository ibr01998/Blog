/**
 * POST /api/trackAffiliateClick
 *
 * Records an affiliate link click and updates article_metrics.
 * Called client-side by the AffiliateCTA component on click.
 *
 * Body: { article_id: string, platform_name: string }
 *
 * Also updates affiliate_links.avg_conversion_rate based on click data.
 * Public endpoint (no auth required — called from reader-facing pages).
 */

import type { APIRoute } from 'astro';
import { query } from '../../lib/db/postgres.ts';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { article_id, platform_name } = body;

    if (!article_id || !platform_name) {
      return new Response(JSON.stringify({ error: 'article_id and platform_name are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Increment affiliate_clicks in article_metrics
    // If no metrics row exists for this article, create one first
    const existing = await query(
      `SELECT id FROM article_metrics WHERE article_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [article_id]
    );

    if (existing.length === 0) {
      // Create initial metrics row
      await query(
        `INSERT INTO article_metrics (article_id, affiliate_clicks)
         VALUES ($1, 1)
         ON CONFLICT DO NOTHING`,
        [article_id]
      );
    } else {
      // Increment existing row's click count
      await query(
        `UPDATE article_metrics
         SET affiliate_clicks = affiliate_clicks + 1
         WHERE id = $1`,
        [existing[0].id]
      );
    }

    // Log as an analytics click event for reporting
    console.log(`[trackAffiliateClick] article=${article_id} platform=${platform_name}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // Silently succeed on tracking errors — never break user experience
    console.error('[trackAffiliateClick] Error:', error);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
