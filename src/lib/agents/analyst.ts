/**
 * AnalystAgent — reads performance metrics and generates a strategic report.
 *
 * Responsibilities:
 *  - Query article_metrics + agents for writer performance
 *  - Query affiliate_links for conversion performance
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
  ContentTier,
  HookType,
  FormatType,
} from './types.ts';

const analystOutputSchema = z.object({
  recommended_content_tier: z.enum(['money', 'authority', 'trend']),
  recommended_hook_type: z.enum(['fear', 'curiosity', 'authority', 'benefit', 'story']),
  recommended_format_type: z.enum(['comparison', 'review', 'bonus', 'trust', 'fee', 'guide']),
  performance_insights: z.array(z.string()).min(2).max(8),
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

    // 3. Update performance scores for writer agents based on metrics
    for (const w of writerStats) {
      const score = Math.min(1.0, Math.max(0.0,
        (w.avg_ctr * 0.4) + (w.avg_conversion_rate * 0.6)
      ));
      await query(
        `UPDATE agents SET performance_score = $1 WHERE id = $2`,
        [score, w.writer_id]
      );
    }

    // 4. Ask the LLM to interpret the data and make strategic recommendations
    const hasData = writerStats.length > 0 || affiliateStats.length > 0;

    const llmOutput = await this.callObject({
      schema: analystOutputSchema,
      model: 'gpt-4o-mini',
      systemPrompt: this.buildSystemPrompt(),
      userPrompt: `
Analyze the following performance data for a Dutch crypto affiliate blog (ShortNews.tech).
${!hasData ? 'NOTE: This is the first run — there is no performance data yet. Use defaults and recommend starting with money-tier content.' : ''}

WRITER PERFORMANCE DATA:
${JSON.stringify(writerStats, null, 2)}

AFFILIATE LINK PERFORMANCE:
${JSON.stringify(affiliateStats, null, 2)}

Based on this data:
1. Recommend the optimal content_tier, hook_type, and format_type for the next editorial cycle
2. Provide 3-6 specific performance insights (what is working, what is not)
3. Suggest behavior overrides for any underperforming agents (only if data shows clear issues)
4. Focus on Dutch crypto market: NL/BE traders, platforms BitMEX/Bybit/Binance/Kraken

If data is empty or insufficient, recommend money tier with benefit hook and comparison format as safe defaults.
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
    };

    // 5. Log evolution suggestions separately for admin review
    for (const suggestion of llmOutput.suggested_agent_overrides) {
      await this.log({
        stage: 'evolution:suggestion',
        inputSummary: { agent_id: suggestion.agent_id },
        decisionSummary: { suggested_overrides: suggestion.suggested_overrides },
        reasoningSummary: suggestion.reasoning,
      });
    }

    // 6. Log the main analyst report
    await this.log({
      stage: 'analyst:report',
      inputSummary: {
        writer_count: writerStats.length,
        affiliate_count: affiliateStats.length,
        has_data: hasData,
      },
      decisionSummary: {
        recommended_tier: report.recommended_content_tier,
        recommended_hook: report.recommended_hook_type,
        recommended_format: report.recommended_format_type,
      },
      reasoningSummary: report.performance_insights.join(' | '),
    });

    return report;
  }

  private buildSystemPrompt(): string {
    const tone = (this.mergedConfig as any).tone ?? 'analytical';
    return `You are an editorial performance analyst for ShortNews, a Dutch crypto affiliate blog.

Your role: analyze article performance metrics and affiliate conversion data to guide content strategy.
Tone: ${tone}.

CONTEXT:
- Blog: ShortNews.tech — Dutch-language crypto content for NL/BE market
- Monetization: affiliate programs (BitMEX, Bybit, Binance, Kraken)
- Primary KPIs: CTR (click-through rate), affiliate_clicks, conversion_count, avg_time_on_page
- Content tiers: money (conversion), authority (educational), trend (timely)

ANALYSIS PRINCIPLES:
- Focus on CTR × conversion as primary quality signal
- High time-on-page with low CTR = engaging but not converting (authority content issue)
- Low time-on-page = poor content or wrong audience targeting
- Conversion rate > 0.05 per view = excellent affiliate performance
- Be specific in insights — no generic advice`;
  }
}
