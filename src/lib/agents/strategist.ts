/**
 * StrategistAgent — generates 5 article briefs per editorial cycle.
 *
 * Responsibilities:
 *  - Take AnalystReport as input
 *  - Produce exactly 5 article briefs
 *  - Enforce 3 money / 1 authority / 1 trend distribution
 *  - Use classifyIntent() from existing templates.ts for intent classification
 *  - Log reasoning to agent_logs
 */

import { z } from 'zod';
import { BaseAgent } from './base.ts';
import type { AgentRecord, AnalystReport, ArticleBrief } from './types.ts';
import { classifyIntent } from '../../data/templates.ts';

const briefItemSchema = z.object({
  primary_keyword: z.string().min(3),
  title_suggestion: z.string().min(10),
  content_tier: z.enum(['money', 'authority', 'trend']),
  intent: z.string(),
  hook_type: z.enum(['fear', 'curiosity', 'authority', 'benefit', 'story']),
  format_type: z.enum(['comparison', 'review', 'bonus', 'trust', 'fee', 'guide']),
  target_word_count: z.number().int().min(600).max(2500),
  target_platforms: z.array(z.string()),
  affiliate_focus: z.string(),
  reasoning: z.string(),
});

const strategistOutputSchema = z.object({
  briefs: z.array(briefItemSchema).length(5),
});

// Dutch crypto topic seeds — strategist uses these as creative starting points
const CRYPTO_TOPIC_SEEDS = [
  'bybit review 2026',
  'binance vs kraken nederland',
  'bitmex fees uitleg',
  'crypto leverage trading beginners nederland',
  'beste crypto exchange nederland 2026',
  'bybit bonus welkomstbonus',
  'kraken betrouwbaar',
  'bitcoin futures trading platform vergelijking',
  'crypto staking vergelijking exchange',
  'crypto portfolio voor beginners',
  'bitmex vs bybit',
  'binance kosten overzicht',
  'kraken fees nl',
  'crypto exchange veiligheid nederland',
  'bybit ervaringen nl',
];

export class StrategistAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  async run(report: AnalystReport): Promise<ArticleBrief[]> {
    const bestAffiliate = report.best_affiliate?.platform_name ?? 'Bybit';

    const result = await this.callObject({
      schema: strategistOutputSchema,
      model: 'gpt-4o-mini',
      systemPrompt: this.buildSystemPrompt(report),
      userPrompt: `
Generate exactly 5 article briefs for ShortNews, a Dutch crypto affiliate blog.

MANDATORY TIER DISTRIBUTION:
- 3 articles: content_tier = "money" (conversion-focused: comparison, review, bonus formats)
- 1 article: content_tier = "authority" (educational: trust, fee, guide formats)
- 1 article: content_tier = "trend" (timely/opinionated: any format with opinionated angle)

ANALYST RECOMMENDATIONS (apply these):
- Recommended tier: ${report.recommended_content_tier}
- Recommended hook type: ${report.recommended_hook_type}
- Recommended format: ${report.recommended_format_type}
- Top insights: ${report.performance_insights.slice(0, 3).join('; ')}

BEST PERFORMING AFFILIATE: ${bestAffiliate} — prioritize in money-tier content

AVAILABLE PLATFORMS: BitMEX, Bybit, Binance, Kraken

TOPIC SEED IDEAS (use as inspiration — vary and improve these):
${CRYPTO_TOPIC_SEEDS.map((t, i) => `${i + 1}. ${t}`).join('\n')}

REQUIREMENTS:
- All primary_keywords must be Dutch search queries
- title_suggestion must be Dutch, click-worthy, max 70 chars
- target_word_count: money=1000-1500, authority=1200-2000, trend=700-1000
- target_platforms: relevant exchange slugs (bitmex/bybit/binance/kraken)
- reasoning: 1-2 sentences explaining why this brief will convert or rank
- Spread keywords across all 4 platforms — no single platform dominating
`,
    });

    const briefs: ArticleBrief[] = result.briefs.map((b) => ({
      brief_id: crypto.randomUUID(),
      ...b,
      // Override intent with template classification if LLM missed it
      intent: b.intent || classifyIntent(b.primary_keyword),
    }));

    // Verify tier distribution before logging
    const tierCount = briefs.reduce((acc, b) => {
      acc[b.content_tier] = (acc[b.content_tier] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    await this.log({
      stage: 'strategist:briefs',
      inputSummary: {
        analyst_tier: report.recommended_content_tier,
        best_affiliate: bestAffiliate,
        insights_count: report.performance_insights.length,
      },
      decisionSummary: {
        brief_count: briefs.length,
        tier_distribution: tierCount,
        keywords: briefs.map((b) => b.primary_keyword),
      },
      reasoningSummary: `Generated ${briefs.length} briefs. Tier distribution: money=${tierCount.money ?? 0}, authority=${tierCount.authority ?? 0}, trend=${tierCount.trend ?? 0}. Best affiliate prioritized: ${bestAffiliate}.`,
    });

    return briefs;
  }

  private buildSystemPrompt(report: AnalystReport): string {
    return `You are the content strategist for ShortNews (ShortNews.tech), a Dutch crypto affiliate blog.

Your job: create high-quality article briefs that drive affiliate conversions and SEO traffic in the Dutch market.

BLOG CONTEXT:
- Language: Dutch (nl)
- Target audience: crypto traders in the Netherlands and Belgium
- Monetization: affiliate programs via /go/{slug} links (BitMEX, Bybit, Binance, Kraken)
- SEO focus: Dutch-language keywords with search intent in the NL/BE market
- Content philosophy: honest, factual, direct — no empty hype

BRIEF QUALITY STANDARDS:
- Each brief must have a distinct keyword (no overlap between 5 briefs)
- Target keywords that balance search volume with low competition
- Think like a Dutch trader: "goedkoop", "betrouwbaar", "beginners", "vergelijken"
- Money content should feel natural, not forced
- Authority content builds trust that converts later

${(this.mergedConfig as any).tone ? `Tone preference: ${(this.mergedConfig as any).tone}` : ''}`;
  }
}
