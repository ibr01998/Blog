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
import { query } from '../db/postgres.ts';
import type { AgentRecord, AnalystReport, ArticleBrief, MarketResearchRow } from './types.ts';
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

// Dutch crypto topic seeds — fallback when no recent market_research data exists
const FALLBACK_TOPIC_SEEDS = [
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

interface HistoricalArticleRow {
  title: string;
  primary_keyword: string;
  content_tier: string;
  intent: string;
  format_type: string;
  created_at: string;
  ctr: number;
  views: number;
}

const KNOWN_PLATFORMS = ['bybit', 'binance', 'kraken', 'bitmex'];
const ALL_INTENTS = ['comparison', 'review', 'bonus', 'trust', 'fee', 'guide'];

export class StrategistAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  async run(report: AnalystReport): Promise<ArticleBrief[]> {
    const bestAffiliate = report.best_affiliate?.platform_name ?? 'Bybit';

    // ── Fetch ALL historical articles with performance data ───────────────
    let historicalArticles: HistoricalArticleRow[] = [];
    try {
      historicalArticles = await query<HistoricalArticleRow>(`
        SELECT
          a.title,
          a.primary_keyword,
          COALESCE(a.content_tier, 'money') as content_tier,
          COALESCE(a.intent, 'comparison') as intent,
          COALESCE(a.format_type, 'comparison') as format_type,
          a.created_at,
          COALESCE(m.ctr, 0)::float as ctr,
          COALESCE(m.views, 0)::int as views
        FROM articles a
        LEFT JOIN article_metrics m ON m.article_id = a.id
        ORDER BY a.created_at DESC
      `);
    } catch {
      // Articles table unavailable — proceed without history
    }

    // ── Build platform × intent coverage map ─────────────────────────────
    const coverageMap: Record<string, Record<string, number>> = {};
    for (const article of historicalArticles) {
      const kw = article.primary_keyword.toLowerCase();
      const titleLower = article.title.toLowerCase();
      for (const platform of KNOWN_PLATFORMS) {
        if (kw.includes(platform) || titleLower.includes(platform)) {
          if (!coverageMap[platform]) coverageMap[platform] = {};
          const intent = article.intent || 'unknown';
          coverageMap[platform][intent] = (coverageMap[platform][intent] || 0) + 1;
        }
      }
    }

    // ── Find unexplored content gaps ──────────────────────────────────────
    const gaps: string[] = [];
    for (const platform of KNOWN_PLATFORMS) {
      for (const intent of ALL_INTENTS) {
        const count = coverageMap[platform]?.[intent] ?? 0;
        if (count === 0) gaps.push(`${platform} × ${intent} (NEVER written — high priority)`);
        else if (count === 1) gaps.push(`${platform} × ${intent} (only once — fresh angle possible)`);
      }
    }

    // ── Build article history context for the LLM ─────────────────────────
    const sortedByPerf = [...historicalArticles].sort((a, b) => b.ctr - a.ctr);
    const topPerformers = sortedByPerf.slice(0, 5).filter(a => a.ctr > 0);
    const recentArticles = historicalArticles.slice(0, 30);

    const historyContext = historicalArticles.length > 0 ? `
FULL ARTICLE MEMORY (${historicalArticles.length} articles ever written — you MUST avoid duplicating these):

Recently Written (last ${Math.min(30, historicalArticles.length)}):
${recentArticles.map((a, i) =>
  `${i + 1}. [${a.content_tier}/${a.intent}] "${a.title}" | keyword: "${a.primary_keyword}" | CTR: ${(a.ctr * 100).toFixed(1)}% | views: ${a.views}`
).join('\n')}

PLATFORM × INTENT COVERAGE (times each angle has been covered):
${KNOWN_PLATFORMS.map(p => {
  const intents = coverageMap[p] ?? {};
  return `${p.toUpperCase()}: ${ALL_INTENTS.map(i => `${i}=${intents[i] ?? 0}`).join(', ')}`;
}).join('\n')}

${topPerformers.length > 0 ? `TOP PERFORMING ARTICLES (replicate these writing styles, NOT topics):
${topPerformers.map((a, i) => `${i + 1}. "${a.title}" → ${(a.ctr * 100).toFixed(1)}% CTR, ${a.views} views`).join('\n')}` : ''}

CONTENT GAPS — prioritize these unexplored combinations:
${gaps.slice(0, 15).join('\n')}

⚠️ CRITICAL RULE: Do NOT generate briefs that duplicate or closely resemble any article listed above.
Each brief must be a genuinely ORIGINAL idea with a unique angle not yet covered on this blog.
` : 'NOTE: No article history found — this is the first editorial cycle.';

    // ── Fetch latest market research (within 7 days) ──────────────────────
    let marketResearch: MarketResearchRow | null = null;
    try {
      const rows = await query<MarketResearchRow>(
        `SELECT * FROM market_research
         WHERE research_date >= CURRENT_DATE - INTERVAL '7 days'
         ORDER BY research_date DESC LIMIT 1`
      );
      marketResearch = rows[0] ?? null;
    } catch {
      // Table not migrated yet or unavailable — fall back to static seeds
    }

    // Prefer research-driven keywords; fall back to static seeds
    const keywordSeeds: string[] = (marketResearch?.recommended_keywords?.length)
      ? marketResearch.recommended_keywords
      : FALLBACK_TOPIC_SEEDS;

    // Build research context block for the LLM prompt
    const researchContext = marketResearch
      ? `
MARKET RESEARCH DATA (${marketResearch.research_date} — Tavily competitor analysis):
Summary: ${marketResearch.insights_summary}

Trending Topics:
${marketResearch.trending_topics.slice(0, 5).map((t) =>
  `- "${t.keyword}" (score: ${t.trend_score.toFixed(2)}): ${t.reason}`
).join('\n')}

Keyword Opportunities (content gaps marked with ⚡):
${marketResearch.keyword_opportunities.slice(0, 5).map((k) =>
  `- ${k.content_gap ? '⚡' : '·'} "${k.keyword}" | angle: ${k.suggested_angle} | format: ${k.suggested_format}`
).join('\n')}

Competitor Patterns:
- Title patterns: ${marketResearch.competitor_patterns.common_title_patterns?.join(', ') || 'n/a'}
- Popular formats: ${marketResearch.competitor_patterns.popular_formats?.join(', ') || 'n/a'}
`
      : `NOTE: No recent market research available. Using static keyword seeds as fallback.`;

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

${historyContext}

${researchContext}

TOPIC SEED IDEAS (use as creative starting points — vary and improve these):
${keywordSeeds.map((t, i) => `${i + 1}. ${t}`).join('\n')}

REQUIREMENTS:
- All primary_keywords must be Dutch search queries
- title_suggestion must be Dutch, click-worthy, max 70 chars
- target_word_count: money=800-1200, authority=1000-1500, trend=500-800
- target_platforms: relevant exchange slugs (bitmex/bybit/binance/kraken)
- reasoning: 1-2 sentences explaining why this brief will convert or rank
- Spread keywords across all 4 platforms — no single platform dominating
- MANDATORY: Each brief must target a gap in the coverage map above
${marketResearch ? '- PRIORITIZE ⚡ content gap opportunities over general seeds' : ''}
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
        research_used: marketResearch !== null,
        research_date: marketResearch?.research_date ?? null,
        total_articles_in_memory: historicalArticles.length,
        coverage_map: coverageMap,
        content_gaps_found: gaps.length,
      },
      decisionSummary: {
        brief_count: briefs.length,
        tier_distribution: tierCount,
        keywords: briefs.map((b) => b.primary_keyword),
      },
      reasoningSummary: `Generated ${briefs.length} briefs with full article memory (${historicalArticles.length} past articles). Research data ${marketResearch ? `used (${marketResearch.research_date})` : 'not available — used fallback seeds'}. Found ${gaps.length} content gaps. Tier: money=${tierCount.money ?? 0}, authority=${tierCount.authority ?? 0}, trend=${tierCount.trend ?? 0}. Best affiliate: ${bestAffiliate}.`,
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
