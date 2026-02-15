/**
 * GET /api/analytics/ai-performance
 *
 * Returns AI content performance data for the dashboard:
 * - Strategy breakdown (which tier/hook/format works best)
 * - Writer agent performance comparison
 * - Weekly trend data (8 weeks)
 * - Latest analyst recommendations
 * - Top and bottom performing articles
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/postgres.ts';

export const GET: APIRoute = async () => {
  try {
    // 1. Strategy breakdown from content_strategy_metrics
    const strategyBreakdown = await query(`
      SELECT
        content_tier, hook_type, format_type,
        article_count, avg_views, avg_ctr,
        avg_time_on_page, avg_bounce_rate,
        total_affiliate_clicks, avg_conversion_rate
      FROM content_strategy_metrics
      WHERE computed_at = (SELECT MAX(computed_at) FROM content_strategy_metrics)
      ORDER BY avg_ctr DESC
    `);

    // 2. Writer performance comparison
    const writerPerformance = await query(`
      SELECT
        ag.name as writer_name,
        COUNT(a.id)::int as total_articles,
        COALESCE(AVG(m.views), 0)::float as avg_views,
        COALESCE(AVG(m.ctr), 0)::float as avg_ctr,
        COALESCE(AVG(m.avg_time_on_page), 0)::float as avg_time_on_page,
        COALESCE(AVG(m.bounce_rate), 0)::float as avg_bounce_rate,
        COALESCE(SUM(m.affiliate_clicks), 0)::int as total_affiliate_clicks,
        ag.performance_score::float as performance_score
      FROM agents ag
      LEFT JOIN articles a ON a.writer_id = ag.id AND a.status = 'published'
      LEFT JOIN article_metrics m ON m.article_id = a.id
      WHERE ag.role = 'writer' AND ag.is_active = true
      GROUP BY ag.id, ag.name, ag.performance_score
      ORDER BY ag.performance_score DESC
    `);

    // 3. Weekly trend (last 8 weeks)
    const weeklyTrend = await query(`
      SELECT
        DATE_TRUNC('week', a.created_at)::date as week_start,
        COUNT(*)::int as articles,
        COALESCE(AVG(m.views), 0)::float as avg_views,
        COALESCE(AVG(m.ctr), 0)::float as avg_ctr,
        COALESCE(AVG(m.avg_time_on_page), 0)::float as avg_time,
        COALESCE(AVG(m.bounce_rate), 0)::float as avg_bounce_rate,
        COALESCE(SUM(m.affiliate_clicks), 0)::int as total_clicks
      FROM articles a
      JOIN article_metrics m ON m.article_id = a.id
      WHERE a.status = 'published'
        AND a.created_at > NOW() - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', a.created_at)
      ORDER BY week_start ASC
    `);

    // 4. Latest analyst recommendations (from agent_logs)
    const latestReport = await query(`
      SELECT decision_summary, reasoning_summary, created_at
      FROM agent_logs
      WHERE stage = 'analyst:report'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    // 5. Top performing articles (by CTR)
    const topPerformers = await query(`
      SELECT
        a.title, a.slug, a.content_tier, a.hook_type, a.format_type,
        m.views, m.ctr, m.avg_time_on_page, m.affiliate_clicks, m.bounce_rate
      FROM articles a
      JOIN article_metrics m ON m.article_id = a.id
      WHERE a.status = 'published' AND m.views > 0
      ORDER BY m.ctr DESC
      LIMIT 5
    `);

    // 6. Underperforming articles (high views but low CTR, or high bounce)
    const underperformers = await query(`
      SELECT
        a.title, a.slug, a.content_tier, a.hook_type, a.format_type,
        m.views, m.ctr, m.avg_time_on_page, m.affiliate_clicks, m.bounce_rate
      FROM articles a
      JOIN article_metrics m ON m.article_id = a.id
      WHERE a.status = 'published' AND m.views > 0
      ORDER BY m.bounce_rate DESC, m.ctr ASC
      LIMIT 5
    `);

    // 7. Overall totals
    const totals = await query(`
      SELECT
        COUNT(*)::int as total_articles,
        COALESCE(SUM(m.views), 0)::int as total_views,
        COALESCE(SUM(m.affiliate_clicks), 0)::int as total_affiliate_clicks,
        COALESCE(AVG(m.ctr), 0)::float as avg_ctr,
        COALESCE(AVG(m.avg_time_on_page), 0)::float as avg_time_on_page,
        COALESCE(AVG(m.bounce_rate), 0)::float as avg_bounce_rate
      FROM articles a
      JOIN article_metrics m ON m.article_id = a.id
      WHERE a.status = 'published'
    `);

    const recommendations = latestReport[0] ? {
      ...(latestReport[0] as any).decision_summary,
      insights: (latestReport[0] as any).reasoning_summary,
      generated_at: (latestReport[0] as any).created_at,
    } : null;

    return new Response(JSON.stringify({
      strategyBreakdown,
      writerPerformance,
      weeklyTrend,
      recommendations,
      topPerformers,
      underperformers,
      totals: totals[0] ?? null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ai-performance] Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch AI performance data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
