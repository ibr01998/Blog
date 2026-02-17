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
    }

    // 6. Ask the LLM to interpret all data and make strategic recommendations
    const hasData = writerStats.some(w => w.total_articles > 0);
    const hasStrategyData = strategyStats.length > 0;
    const recentTrend = trendData.find(t => t.period === 'recent');
    const olderTrend = trendData.find(t => t.period === 'older');

    const llmOutput = await this.callObject({
      schema: analystOutputSchema,
      model: 'gpt-4o-mini',
      systemPrompt: this.buildSystemPrompt(),
      userPrompt: `
Analyze the following performance data for a Dutch crypto affiliate blog (ShortNews.tech).
${!hasData ? 'NOTE: This is an early-stage blog with limited data. Use defaults and recommend starting with money-tier content.' : ''}

WRITER PERFORMANCE DATA:
${JSON.stringify(writerStats, null, 2)}

AFFILIATE LINK PERFORMANCE:
${JSON.stringify(affiliateStats, null, 2)}

${hasStrategyData ? `CONTENT STRATEGY PERFORMANCE (which tier/hook/format combo works best):
${JSON.stringify(strategyStats, null, 2)}` : 'CONTENT STRATEGY PERFORMANCE: No data yet — first cycle.'}

TREND ANALYSIS (recent 14 days vs prior 14-60 days):
- Recent period: ${recentTrend ? `${recentTrend.article_count} articles, avg ${recentTrend.avg_views.toFixed(1)} views, ${(recentTrend.avg_ctr * 100).toFixed(1)}% CTR, ${recentTrend.avg_time.toFixed(0)}s avg time` : 'No recent articles'}
- Older period: ${olderTrend ? `${olderTrend.article_count} articles, avg ${olderTrend.avg_views.toFixed(1)} views, ${(olderTrend.avg_ctr * 100).toFixed(1)}% CTR, ${olderTrend.avg_time.toFixed(0)}s avg time` : 'No older articles'}

Based on this data:
1. Recommend the optimal content_tier, hook_type, and format_type for the next editorial cycle
2. Provide 3-6 specific performance insights (what is working, what is not)
3. Suggest behavior overrides for any underperforming agents (only if data shows clear issues)
4. Identify the best_performing_strategy combination (if strategy data exists, otherwise null)
5. Determine trend_direction: are metrics improving, stable, or declining?
6. Focus on Dutch crypto market: NL/BE traders, platforms BitMEX/Bybit/Binance/Kraken

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
- Blog: ShortNews.tech — Dutch-language crypto content for NL/BE market
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
