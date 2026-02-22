/**
 * AnalystAgent — reads performance metrics and generates a strategic report.
 *
 * Responsibilities:
 *  - Query article_metrics + agents for writer performance
 *  - Query affiliate_links for conversion performance
 *  - Query content_strategy_metrics for strategy effectiveness
 *  - Compare recent vs older performance for trend analysis
 *  - Update performance_score for each writer agent
 *  - Use LLM to interpret data and produce recommendations
 *  - Generate evolution override suggestions for weak agents
 *  - Log all reasoning to agent_logs
 */

import { z } from 'zod';
import { BaseAgent } from './base.ts';
import { query } from '../db/postgres.ts';
import { getAnalyticsSummary, getConversionEvents } from '../analytics/ga4.ts';
import type {
  AgentRecord,
  AnalystReport,
  WriterPerformance,
  AffiliateLinkPerformance,
  ContentStrategyPerformance,
  ContentTier,
  HookType,
  FormatType,
} from './types.ts';

const analystOutputSchema = z.object({
  recommended_content_tier: z.enum(['money', 'authority', 'trend']),
  recommended_hook_type: z.enum(['fear', 'curiosity', 'authority', 'benefit', 'story']),
  recommended_format_type: z.enum(['comparison', 'review', 'bonus', 'trust', 'fee', 'guide']),
  performance_insights: z.array(z.string()),
  suggested_agent_overrides: z.array(z.object({
    agent_id: z.string(),
    suggested_overrides: z.object({
      reduce_hype: z.boolean().nullable(),
      increase_assertiveness: z.boolean().nullable(),
      lower_wordcount: z.boolean().nullable(),
      avoid_platform: z.string().nullable(),
      keyword_density_target: z.number().nullable(),
    }),
    reasoning: z.string(),
  })),
  best_performing_strategy: z.object({
    content_tier: z.enum(['money', 'authority', 'trend']),
    hook_type: z.enum(['fear', 'curiosity', 'authority', 'benefit', 'story']),
    format_type: z.enum(['comparison', 'review', 'bonus', 'trust', 'fee', 'guide']),
    reason: z.string(),
  }).nullable(),
  trend_direction: z.enum(['improving', 'stable', 'declining']),
});

export class AnalystAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  async run(): Promise<AnalystReport> {
    // 1. Query writer performance aggregated from articles + article_metrics
    const writerStats = await query<WriterPerformance & { writer_id: string; writer_name: string }>(`
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

    // 2. Query affiliate performance
    const affiliateStats = await query<AffiliateLinkPerformance>(`
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

    // 3. Query content strategy performance (which tier/hook/format combos work best)
    const strategyStats = await query<ContentStrategyPerformance>(`
      SELECT
        content_tier, hook_type, format_type,
        article_count, avg_views, avg_ctr,
        avg_time_on_page, avg_bounce_rate,
        total_affiliate_clicks, avg_conversion_rate
      FROM content_strategy_metrics
      WHERE computed_at = (SELECT MAX(computed_at) FROM content_strategy_metrics)
      ORDER BY avg_ctr DESC
    `);

    // 4. Trend analysis: compare recent articles vs older ones
    const trendData = await query<{
      period: string;
      avg_views: number;
      avg_ctr: number;
      avg_time: number;
      article_count: number;
    }>(`
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

    // 5. Update performance scores for writer agents based on metrics
    for (const w of writerStats) {
      const score = Math.min(1.0, Math.max(0.0,
        (w.avg_ctr * 0.4) + (w.avg_conversion_rate * 0.6)
      ));
      await query(
        `UPDATE agents SET performance_score = $1 WHERE id = $2`,
        [score, w.writer_id]
      );
      // Log a performance snapshot for evolution visualization (every cycle)
      await this.log({
        stage: 'performance:snapshot',
        inputSummary: {
          agent_id: w.writer_id,
          agent_name: w.writer_name,
          performance_score: score,
          avg_ctr: w.avg_ctr,
          avg_conversion_rate: w.avg_conversion_rate,
          avg_time_on_page: w.avg_time_on_page,
          total_articles: w.total_articles,
        },
        decisionSummary: { updated_score: score },
        reasoningSummary: `Performance snapshot: CTR ${(w.avg_ctr * 100).toFixed(2)}%, Conversie ${(w.avg_conversion_rate * 100).toFixed(2)}%, Artikelen ${w.total_articles}`,
      });
    }

    // 6. Fetch Google Analytics 4 data (last 30 days)
    console.log('[Analyst] Fetching GA4 data...');
    const ga4Data = await getAnalyticsSummary(30);
    const ga4Conversions = await getConversionEvents(30);

    // 7. Ask the LLM to interpret all data and make strategic recommendations
    const hasData = writerStats.some(w => w.total_articles > 0);
    const hasStrategyData = strategyStats.length > 0;
    const recentTrend = trendData.find(t => t.period === 'recent');
    const olderTrend = trendData.find(t => t.period === 'older');

    // Build GA4 insights summary
    const ga4Summary = ga4Data ? `
GOOGLE ANALYTICS 4 DATA (Last 30 Days):

Overall Site Performance:
- Total Users: ${ga4Data.totalUsers.toLocaleString()}
- Total Sessions: ${ga4Data.totalSessions.toLocaleString()}
- Total Pageviews: ${ga4Data.totalPageviews.toLocaleString()}
- Avg Session Duration: ${(ga4Data.avgSessionDuration / 60).toFixed(1)} minutes
- Bounce Rate: ${(ga4Data.overallBounceRate * 100).toFixed(1)}%
- Total Conversions: ${ga4Data.totalConversions}

Engagement Metrics:
- Engaged Sessions: ${ga4Data.engagement.engagedSessions.toLocaleString()} (${((ga4Data.engagement.engagedSessions / ga4Data.totalSessions) * 100).toFixed(1)}% of sessions)
- Engagement Rate: ${(ga4Data.engagement.engagementRate * 100).toFixed(1)}%
- Avg Engagement Time: ${(ga4Data.engagement.avgEngagementTimeSeconds / 60).toFixed(1)} minutes
- Events Per User: ${ga4Data.engagement.eventCountPerUser.toFixed(1)}

Scroll Depth Analysis (User Reading Behavior):
- 25% Scroll: ${ga4Data.scrollDepth.scrollDepth25Count.toLocaleString()} events
- 50% Scroll: ${ga4Data.scrollDepth.scrollDepth50Count.toLocaleString()} events (${((ga4Data.scrollDepth.scrollDepth50Count / ga4Data.scrollDepth.totalScrollEvents) * 100).toFixed(1)}% of scrollers)
- 75% Scroll: ${ga4Data.scrollDepth.scrollDepth75Count.toLocaleString()} events (${((ga4Data.scrollDepth.scrollDepth75Count / ga4Data.scrollDepth.totalScrollEvents) * 100).toFixed(1)}% of scrollers)
- 90% Scroll: ${ga4Data.scrollDepth.scrollDepth90Count.toLocaleString()} events (${((ga4Data.scrollDepth.scrollDepth90Count / ga4Data.scrollDepth.totalScrollEvents) * 100).toFixed(1)}% of scrollers)
- Avg Scroll Depth: ${ga4Data.scrollDepth.avgScrollDepth.toFixed(1)}%
- Total Scroll Events: ${ga4Data.scrollDepth.totalScrollEvents.toLocaleString()}

SCROLL DEPTH INSIGHTS:
${ga4Data.scrollDepth.avgScrollDepth < 50
  ? '⚠️ Low scroll depth - users are not reading articles fully. Consider: shorter content, better hooks, clearer structure.'
  : ga4Data.scrollDepth.avgScrollDepth > 70
  ? '✅ High scroll depth - users are engaged and reading content. Current format is working well.'
  : '📊 Moderate scroll depth - some users engage deeply, others leave early. Test different formats.'}

Top Blog Posts (by views, with engagement data):
${ga4Data.blogPostPerformance.slice(0, 10).map((p, i) =>
  `${i + 1}. ${p.title} (${p.path})
     Views: ${p.views} | Users: ${p.uniqueUsers} | Conversions: ${p.conversions}
     Engagement: ${(p.engagementRate * 100).toFixed(1)}% | Avg Time: ${(p.avgEngagementTime / 60).toFixed(1)}min
     Bounce: ${(p.bounceRate * 100).toFixed(1)}% | Exit: ${(p.exitRate * 100).toFixed(1)}%`
).join('\n')}

Top Traffic Sources:
${ga4Data.trafficSources.slice(0, 5).map((s, i) =>
  `${i + 1}. ${s.source} / ${s.medium}${s.campaign !== '(not set)' ? ` / ${s.campaign}` : ''}
     ${s.sessions} sessions, ${s.users} users, ${(s.bounceRate * 100).toFixed(1)}% bounce`
).join('\n')}

Device Breakdown:
${ga4Data.deviceCategories.map((d) =>
  `- ${d.deviceCategory}: ${d.sessions} sessions (${((d.sessions / ga4Data.totalSessions) * 100).toFixed(1)}%), ${(d.bounceRate * 100).toFixed(1)}% bounce`
).join('\n')}

Top Conversion Events:
${ga4Conversions.slice(0, 5).map((e, i) =>
  `${i + 1}. ${e.eventName}: ${e.eventCount} events, ${e.uniqueUsers} users`
).join('\n')}
` : 'GOOGLE ANALYTICS 4 DATA: Not available (credentials not configured or API error)';

    const llmOutput = await this.callObject({
      schema: analystOutputSchema,
      model: 'gpt-4o-mini',
      maxTokens: 2000,
      timeoutMs: 90000, // 90s timeout for analyst (processes large dataset)
      systemPrompt: this.buildSystemPrompt(),
      userPrompt: `
Analyze the following performance data for a Dutch crypto affiliate blog (ShortNews.tech).
${!hasData ? 'NOTE: This is an early-stage blog with limited data. Use defaults and recommend starting with money-tier content.' : ''}

WRITER PERFORMANCE DATA (from Postgres):
${JSON.stringify(writerStats, null, 2)}

AFFILIATE LINK PERFORMANCE (from Postgres):
${JSON.stringify(affiliateStats, null, 2)}

${hasStrategyData ? `CONTENT STRATEGY PERFORMANCE (which tier/hook/format combo works best):
${JSON.stringify(strategyStats, null, 2)}` : 'CONTENT STRATEGY PERFORMANCE: No data yet — first cycle.'}

TREND ANALYSIS (recent 14 days vs prior 14-60 days):
- Recent period: ${recentTrend ? `${recentTrend.article_count} articles, avg ${recentTrend.avg_views.toFixed(1)} views, ${(recentTrend.avg_ctr * 100).toFixed(1)}% CTR, ${recentTrend.avg_time.toFixed(0)}s avg time` : 'No recent articles'}
- Older period: ${olderTrend ? `${olderTrend.article_count} articles, avg ${olderTrend.avg_views.toFixed(1)} views, ${(olderTrend.avg_ctr * 100).toFixed(1)}% CTR, ${olderTrend.avg_time.toFixed(0)}s avg time` : 'No older articles'}

${ga4Summary}

Based on ALL available data (Postgres + GA4):

1. Recommend the optimal content_tier, hook_type, and format_type for the next editorial cycle

2. Provide 3-6 specific performance insights (what is working, what is not)
   - Use GA4 data to validate Postgres metrics (are they aligned?)
   - Identify which blog posts are driving the most traffic and conversions
   - Analyze traffic sources: organic search, social, direct, referral
   - Consider device preferences (mobile vs desktop optimization needs)
   - **CRITICAL: Analyze scroll depth** - are users reading articles fully or dropping off?
     * If avg scroll depth < 50%: Content is too long, boring, or hook fails
     * If 90% scroll events are low: Users aren't reaching CTAs at bottom
     * If 50% scroll is high but 90% is low: Content loses momentum mid-article
   - **CRITICAL: Analyze engagement metrics**:
     * Low engagement rate = users aren't interacting (no clicks, scrolls, events)
     * High bounce + low engagement = content mismatch with traffic source
     * High engagement time but low conversions = CTA placement issues
   - **Content Length Implications**:
     * If scroll depth is low, recommend Writer agent to use lower_wordcount override
     * If engagement time is under 2 minutes, articles might be too short
     * Balance: depth for SEO vs brevity for engagement

3. Suggest behavior overrides for any underperforming agents (only if data shows clear issues)
   Example overrides based on GA4 data:
   - If scroll depth < 50%: Writer → lower_wordcount: true
   - If bounce rate > 70%: Writer → increase_assertiveness: true (stronger hooks)
   - If engagement time is low: Humanizer → reduce_hype: true (more conversational)
   - If specific platform has low conversions: Writer → avoid_platform: "platform-slug"

4. Identify the best_performing_strategy combination (if strategy data exists, otherwise null)

5. Determine trend_direction: are metrics improving, stable, or declining?

6. Focus on Belgian crypto market and global crypto topics — primary audience: Belgian Dutch-speaking readers, platforms BitMEX/Bybit/Binance/Kraken

IMPORTANT: Your recommendations will directly influence agent behavior and article generation.
Be specific and data-driven. If GA4 shows users aren't reading full articles, SAY SO explicitly.
If conversions are low despite high traffic, diagnose WHY (CTA placement, content-traffic mismatch, etc).

If data is empty or insufficient, recommend money tier with benefit hook and comparison format as safe defaults.
Set trend_direction to "stable" if insufficient data.
Set best_performing_strategy to null if no strategy data exists.
`,
    });

    const report: AnalystReport = {
      generated_at: new Date().toISOString(),
      period_days: 30,
      top_writers: writerStats.slice(0, 3) as WriterPerformance[],
      weak_writers: writerStats.slice(-2) as WriterPerformance[],
      best_affiliate: affiliateStats[0] ?? null,
      worst_affiliate: affiliateStats[affiliateStats.length - 1] ?? null,
      recommended_content_tier: llmOutput.recommended_content_tier,
      recommended_hook_type: llmOutput.recommended_hook_type,
      recommended_format_type: llmOutput.recommended_format_type,
      performance_insights: llmOutput.performance_insights,
      suggested_agent_overrides: llmOutput.suggested_agent_overrides,
      strategy_performance: strategyStats,
      trend_direction: llmOutput.trend_direction,
      best_performing_strategy: llmOutput.best_performing_strategy ?? undefined,
    };

    // 7. Log evolution suggestions separately for admin review
    for (const suggestion of llmOutput.suggested_agent_overrides) {
      // Include the performance metrics that triggered this suggestion so the
      // dashboard card can explain *why* this agent was flagged.
      const writerData = writerStats.find(w => w.writer_id === suggestion.agent_id);
      await this.log({
        stage: 'evolution:suggestion',
        inputSummary: {
          agent_id: suggestion.agent_id,
          avg_ctr: writerData?.avg_ctr ?? null,
          avg_conversion_rate: writerData?.avg_conversion_rate ?? null,
          avg_time_on_page: writerData?.avg_time_on_page ?? null,
          total_articles: writerData?.total_articles ?? null,
        },
        decisionSummary: { suggested_overrides: suggestion.suggested_overrides },
        reasoningSummary: suggestion.reasoning,
      });
    }

    // 8. Log the main analyst report
    await this.log({
      stage: 'analyst:report',
      inputSummary: {
        writer_count: writerStats.length,
        affiliate_count: affiliateStats.length,
        strategy_combos: strategyStats.length,
        has_data: hasData,
        trend_direction: llmOutput.trend_direction,
        ga4_available: !!ga4Data,
        ga4_total_users: ga4Data?.totalUsers ?? 0,
        ga4_total_pageviews: ga4Data?.totalPageviews ?? 0,
      },
      decisionSummary: {
        recommended_tier: report.recommended_content_tier,
        recommended_hook: report.recommended_hook_type,
        recommended_format: report.recommended_format_type,
        best_strategy: llmOutput.best_performing_strategy,
        trend: llmOutput.trend_direction,
      },
      reasoningSummary: report.performance_insights.join(' | '),
    });

    return report;
  }

  private buildSystemPrompt(): string {
    const tone = (this.mergedConfig as any).tone ?? 'analytical';
    return `You are an editorial performance analyst for ShortNews, a Dutch crypto affiliate blog.

Your role: analyze article performance metrics, content strategy data, and affiliate conversion data to guide content strategy.
Tone: ${tone}.

CONTEXT:
- Blog: ShortNews.tech — Dutch-language crypto content, primary audience: Belgium (Flanders + Brussels), global scope
- Monetization: affiliate programs (BitMEX, Bybit, Binance, Kraken)
- Primary KPIs: CTR (click-through rate), affiliate_clicks, avg_time_on_page, bounce_rate
- Content tiers: money (conversion), authority (educational), trend (timely)
- Hook types: fear, curiosity, authority, benefit, story
- Format types: comparison, review, bonus, trust, fee, guide

ANALYSIS PRINCIPLES:
- Focus on CTR × conversion as primary quality signal
- High time-on-page with low CTR = engaging but not converting (authority content issue)
- Low time-on-page = poor content or wrong audience targeting
- High bounce rate (>0.7) = article fails to hook readers
- Conversion rate > 0.05 per view = excellent affiliate performance
- Compare strategy combinations to find what works: which tier + hook + format produces the best CTR
- Look at trend direction: are we improving week-over-week?
- Be specific in insights — no generic advice
- When suggesting agent overrides, reference specific data points`;
  }
}
