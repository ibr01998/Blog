/**
 * GET /api/admin/analyst-preview
 *
 * Shows EXACTLY what data the Analyst agent will see when it runs.
 * This is a diagnostic tool to verify GA4 data is flowing correctly.
 * Protected by dashboard session cookie via middleware.ts
 */

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/postgres.ts';
import { getAnalyticsSummary, getConversionEvents } from '../../../lib/analytics/ga4.ts';

export const GET: APIRoute = async () => {
  try {
    console.log('[analyst-preview] Fetching all data sources...');

    // 1. Fetch Writer Performance (same as Analyst agent)
    const writerStats = await query(`
      SELECT
        ag.id as writer_id,
        ag.name as writer_name,
        COALESCE(AVG(m.ctr), 0)::float as avg_ctr,
        COALESCE(AVG(m.avg_time_on_page), 0)::float as avg_time_on_page,
        COALESCE(
          AVG(CASE WHEN m.views > 0 THEN m.conversion_count::float / m.views ELSE 0 END),
          0
        )::float as avg_conversion_rate,
        COUNT(a.id)::int as total_articles,
        COALESCE(MODE() WITHIN GROUP (ORDER BY a.content_tier), 'money') as best_tier
      FROM agents ag
      LEFT JOIN articles a ON a.writer_id = ag.id AND a.status = 'published'
      LEFT JOIN article_metrics m ON m.article_id = a.id
      WHERE ag.role = 'writer' AND ag.is_active = true
      GROUP BY ag.id, ag.name
      ORDER BY avg_ctr DESC NULLS LAST
    `);

    // 2. Fetch Affiliate Performance
    const affiliateStats = await query(`
      SELECT
        al.platform_name,
        COALESCE(al.avg_conversion_rate, 0)::float as avg_conversion_rate,
        COALESCE(SUM(m.affiliate_clicks), 0)::float as total_clicks,
        COALESCE(AVG(m.ctr), 0)::float as avg_ctr,
        al.priority_score::float as priority_score
      FROM affiliate_links al
      LEFT JOIN articles a ON LOWER(a.article_markdown) LIKE LOWER('%' || al.platform_name || '%')
      LEFT JOIN article_metrics m ON m.article_id = a.id
      WHERE al.is_active = true
      GROUP BY al.platform_name, al.avg_conversion_rate, al.priority_score
      ORDER BY al.avg_conversion_rate DESC
    `);

    // 3. Fetch Content Strategy Performance
    const strategyStats = await query(`
      SELECT
        content_tier, hook_type, format_type,
        article_count, avg_views, avg_ctr,
        avg_time_on_page, avg_bounce_rate,
        total_affiliate_clicks, avg_conversion_rate
      FROM content_strategy_metrics
      WHERE computed_at = (SELECT MAX(computed_at) FROM content_strategy_metrics)
      ORDER BY avg_ctr DESC
    `);

    // 4. Fetch Trend Data
    const trendData = await query(`
      SELECT
        'recent' as period,
        COALESCE(AVG(m.views), 0)::float as avg_views,
        COALESCE(AVG(m.ctr), 0)::float as avg_ctr,
        COALESCE(AVG(m.avg_time_on_page), 0)::float as avg_time,
        COUNT(*)::int as article_count
      FROM articles a
      JOIN article_metrics m ON m.article_id = a.id
      WHERE a.status = 'published'
        AND a.created_at > NOW() - INTERVAL '14 days'
      UNION ALL
      SELECT
        'older' as period,
        COALESCE(AVG(m.views), 0)::float,
        COALESCE(AVG(m.ctr), 0)::float,
        COALESCE(AVG(m.avg_time_on_page), 0)::float,
        COUNT(*)::int
      FROM articles a
      JOIN article_metrics m ON m.article_id = a.id
      WHERE a.status = 'published'
        AND a.created_at <= NOW() - INTERVAL '14 days'
        AND a.created_at > NOW() - INTERVAL '60 days'
    `);

    // 5. Fetch GA4 Data (same as Analyst agent)
    console.log('[analyst-preview] Fetching GA4 data...');
    const ga4Data = await getAnalyticsSummary(30);
    const ga4Conversions = await getConversionEvents(30);

    // Build the exact data summary that the Analyst will see
    const hasData = writerStats.some((w: any) => w.total_articles > 0);
    const hasStrategyData = strategyStats.length > 0;
    const recentTrend = trendData.find((t: any) => t.period === 'recent');
    const olderTrend = trendData.find((t: any) => t.period === 'older');

    // Format GA4 summary (exact same as in Analyst)
    const ga4Summary = ga4Data ? {
      available: true,
      overall: {
        total_users: ga4Data.totalUsers,
        total_sessions: ga4Data.totalSessions,
        total_pageviews: ga4Data.totalPageviews,
        avg_session_duration_minutes: (ga4Data.avgSessionDuration / 60).toFixed(1),
        bounce_rate_percent: (ga4Data.overallBounceRate * 100).toFixed(1),
        conversions: ga4Data.totalConversions,
      },
      engagement: {
        engaged_sessions: ga4Data.engagement.engagedSessions,
        engagement_rate_percent: (ga4Data.engagement.engagementRate * 100).toFixed(1),
        avg_engagement_time_minutes: (ga4Data.engagement.avgEngagementTimeSeconds / 60).toFixed(1),
        events_per_user: ga4Data.engagement.eventCountPerUser.toFixed(1),
      },
      scroll_depth: {
        avg_depth_percent: ga4Data.scrollDepth.avgScrollDepth.toFixed(1),
        scroll_25_count: ga4Data.scrollDepth.scrollDepth25Count,
        scroll_50_count: ga4Data.scrollDepth.scrollDepth50Count,
        scroll_75_count: ga4Data.scrollDepth.scrollDepth75Count,
        scroll_90_count: ga4Data.scrollDepth.scrollDepth90Count,
        total_events: ga4Data.scrollDepth.totalScrollEvents,
        analysis: ga4Data.scrollDepth.avgScrollDepth < 50
          ? 'LOW - Users not reading articles fully'
          : ga4Data.scrollDepth.avgScrollDepth > 70
          ? 'HIGH - Users engaged and reading content'
          : 'MODERATE - Mixed engagement',
      },
      top_blog_posts: ga4Data.blogPostPerformance.slice(0, 10).map(p => ({
        path: p.path,
        title: p.title,
        views: p.views,
        users: p.uniqueUsers,
        conversions: p.conversions,
        engagement_rate_percent: (p.engagementRate * 100).toFixed(1),
        bounce_rate_percent: (p.bounceRate * 100).toFixed(1),
        exit_rate_percent: (p.exitRate * 100).toFixed(1),
        avg_engagement_time_minutes: (p.avgEngagementTime / 60).toFixed(1),
      })),
      traffic_sources: ga4Data.trafficSources.slice(0, 5).map(s => ({
        source: s.source,
        medium: s.medium,
        campaign: s.campaign,
        sessions: s.sessions,
        users: s.users,
        bounce_rate_percent: (s.bounceRate * 100).toFixed(1),
      })),
      devices: ga4Data.deviceCategories.map(d => ({
        category: d.deviceCategory,
        sessions: d.sessions,
        percentage: ((d.sessions / ga4Data.totalSessions) * 100).toFixed(1),
        bounce_rate_percent: (d.bounceRate * 100).toFixed(1),
      })),
      conversion_events: ga4Conversions.slice(0, 5).map(e => ({
        name: e.eventName,
        count: e.eventCount,
        users: e.uniqueUsers,
      })),
    } : {
      available: false,
      reason: 'GA4 credentials not configured or API error',
    };

    return new Response(JSON.stringify({
      success: true,
      message: 'This is EXACTLY what the Analyst agent sees',
      data_sources: {
        postgres: {
          writer_stats: writerStats,
          affiliate_stats: affiliateStats,
          strategy_stats: strategyStats,
          trend_data: trendData,
          has_data: hasData,
          has_strategy_data: hasStrategyData,
        },
        ga4: ga4Summary,
      },
      recommendations: {
        data_quality: hasData ? 'Good - historical data available' : 'Limited - early stage blog',
        ga4_status: ga4Summary.available ? '✅ GA4 connected and providing insights' : '❌ GA4 not available',
        next_steps: !ga4Summary.available
          ? 'Set up GA4 integration (see /GA4_SETUP.md) to unlock rich analytics'
          : ga4Data && ga4Data.scrollDepth.avgScrollDepth < 50
          ? 'Consider enabling lower_wordcount for Writer agent - users not finishing articles'
          : 'System has full data access - Analyst can make informed decisions',
      },
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[analyst-preview] Error:', errorMessage);

    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to fetch analyst data preview',
      details: errorMessage,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
