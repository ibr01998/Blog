/**
 * StrategistAgent — master governor + brief generator for the editorial engine.
 *
 * Responsibilities:
 *  - Governor phase: decide next_run_timestamp and articles_this_cycle
 *  - Brief phase: generate 5 article briefs per editorial cycle
 *  - Enforce content tier distribution
 *  - Analyze market research and historical performance for both phases
 *  - Log reasoning to agent_logs
 */

import { z } from 'zod';
import { BaseAgent } from './base.ts';
import { query } from '../db/postgres.ts';
import type {
  AgentRecord,
  AnalystReport,
  ArticleBrief,
  MarketResearchRow,
  StrategistGovernorOutput,
} from './types.ts';
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
  'bybit review belgie 2026',
  'binance vs kraken belgie vergelijking',
  'bitmex fees uitleg beginners',
  'crypto leverage trading beginners fouten',
  'beste crypto exchange belgie 2026',
  'bybit bonus welkomstbonus belgie',
  'kraken betrouwbaar veilig',
  'bitcoin futures trading platform vergelijking',
  'crypto staking opbrengst vergelijking 2026',
  'crypto portfolio beginners strategie',
  'bitmex vs bybit gevorderde traders',
  'binance kosten overzicht belgie',
  'kraken fees uitleg belgie',
  'crypto belasting belgie 2026 aangifte',
  'bitcoin inflatie hedge belgie 2026',
  'MiCA crypto regulering belgie gevolgen',
  'crypto trading psychologie fomo vermijden',
  'bitcoin halving 2024 effect analyse',
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

// Schema for the governor decision output
const governorOutputSchema = z.object({
  next_run_timestamp: z.string(),
  articles_this_cycle: z.number().int().min(1).max(10),
  topic_priority: z.string(),
  reasoning: z.string(),
  cadence_adjustment: z.enum(['increase', 'maintain', 'decrease']),
});

export class StrategistAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  /**
   * Governor phase — decide WHEN to publish next and HOW MANY articles.
   * Runs before brief generation. Writes scheduling decisions to system_config.
   */
  async runGovernor(report: AnalystReport): Promise<StrategistGovernorOutput> {
    // Fetch recent publishing history
    let recentPublishCount = 0;
    let avgDaysBetweenArticles = 3.5;
    try {
      const countRows = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM articles WHERE created_at >= NOW() - INTERVAL '30 days'`
      );
      recentPublishCount = parseInt(countRows[0]?.count ?? '0');

      if (recentPublishCount > 1) {
        const spanRows = await query<{ span_days: number }>(
          `SELECT EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / 86400.0 as span_days
           FROM articles WHERE created_at >= NOW() - INTERVAL '30 days'`
        );
        const spanDays = spanRows[0]?.span_days ?? 30;
        avgDaysBetweenArticles = spanDays / Math.max(recentPublishCount - 1, 1);
      }
    } catch {
      // DB unavailable — use defaults
    }

    // Fetch current publish frequency history
    let frequencyHistory: unknown[] = [];
    try {
      const cfgRows = await query<{ publish_frequency_history: unknown }>(
        `SELECT publish_frequency_history FROM system_config WHERE id = 1`
      );
      const raw = cfgRows[0]?.publish_frequency_history;
      frequencyHistory = Array.isArray(raw) ? raw : [];
    } catch {
      // ignore
    }

    const result = await this.callObject({
      schema: governorOutputSchema,
      model: 'gpt-4o-mini',
      maxTokens: 1000,
      timeoutMs: 30000,
      systemPrompt: `Je bent de strategische gouverneur van ShortNews, een Belgische crypto blog.

TAAK: Bepaal het optimale publicatieschema op basis van prestaties en trends.

BESLISSINGEN:
1. next_run_timestamp: Wanneer moet de volgende publicatiecyclus worden gestart? (ISO8601 formaat)
2. articles_this_cycle: Hoeveel artikelen moeten er deze cyclus worden geproduceerd? (1-5)
3. cadence_adjustment: Moet het publicatietempo verhoogd, behouden of verlaagd worden?

REGELS:
- Als het verkeer GROEIT (trend_direction = "improving"): overweeg meer artikelen
- Als het verkeer DAALT (trend_direction = "declining"): focus op kwaliteit, minder artikelen
- Als STABIEL: behoud huidig tempo
- Minimum interval: 24 uur tussen cycli
- Maximum interval: 7 dagen
- Standaard: 2-3 dagen, 2-3 artikelen per cyclus
- Houdt rekening met weekdagen (publiceer voorkeur op Di-Do ochtend)`,
      userPrompt: `HUIDIGE PRESTATIES:
- Trend richting: ${report.trend_direction}
- Top inzichten: ${report.performance_insights.slice(0, 3).join('; ')}
- Artikelen afgelopen 30 dagen: ${recentPublishCount}
- Gemiddeld dagen tussen artikelen: ${avgDaysBetweenArticles.toFixed(1)}

HUISTIG PUBLICATIETEMPO:
${frequencyHistory.length > 0 ? JSON.stringify(frequencyHistory.slice(-5)) : 'Geen geschiedenis beschikbaar'}

Huidige datum/tijd: ${new Date().toISOString()}

Bepaal het optimale schema.`,
    });

    // Write scheduling decisions to system_config
    try {
      // Update frequency history
      const newEntry = {
        timestamp: new Date().toISOString(),
        articles: result.articles_this_cycle,
        cadence: result.cadence_adjustment,
        next_run: result.next_run_timestamp,
      };
      const updatedHistory = [...frequencyHistory.slice(-19), newEntry]; // Keep last 20

      await query(
        `UPDATE system_config
         SET next_run_timestamp = $1,
             articles_this_cycle = $2,
             publish_frequency_history = $3::jsonb
         WHERE id = 1`,
        [
          result.next_run_timestamp,
          result.articles_this_cycle,
          JSON.stringify(updatedHistory),
        ]
      );
    } catch (err) {
      console.warn('[Strategist] Failed to update system_config scheduling:', err);
    }

    await this.log({
      stage: 'strategist:governor',
      inputSummary: {
        trend_direction: report.trend_direction,
        recent_articles_30d: recentPublishCount,
        avg_days_between: avgDaysBetweenArticles,
      },
      decisionSummary: {
        next_run: result.next_run_timestamp,
        articles_this_cycle: result.articles_this_cycle,
        cadence: result.cadence_adjustment,
        topic_priority: result.topic_priority,
      },
      reasoningSummary: result.reasoning,
    });

    return result;
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
Generate exactly 5 article briefs for ShortNews, a Dutch crypto publication.

TIER DISTRIBUTION GUIDELINE (flexible — let research and gaps drive the mix):
- 2 articles: content_tier = "money" (affiliate-intent: comparison, review, bonus formats)
- 2 articles: content_tier = "authority" (editorial: analysis, explainers, opinion, guides — may or may not reference exchanges)
- 1 article: content_tier = "trend" (timely: current events, political/economic angle, opinionated take)

If the research strongly suggests a different split (e.g. a major regulation story is breaking), adjust — just ensure at least 1 money and at least 1 non-money brief.

ANALYST RECOMMENDATIONS:
- Recommended tier: ${report.recommended_content_tier}
- Recommended hook: ${report.recommended_hook_type}
- Recommended format: ${report.recommended_format_type}
- Key insights: ${report.performance_insights.slice(0, 3).join('; ')}

BEST CONVERTING AFFILIATE: ${bestAffiliate} — use in money-tier content where it fits naturally
AVAILABLE PLATFORMS: BitMEX, Bybit, Binance, Kraken
GEOGRAPHIC FOCUS: Belgium (primary) + global crypto topics (most content should be internationally relevant, not hyper-local)

${historyContext}

${researchContext}

TOPIC SEED IDEAS (starting points — these are narrow, go BEYOND them):
${keywordSeeds.map((t, i) => `${i + 1}. ${t}`).join('\n')}

CONTENT TYPE INSPIRATION (think beyond exchange reviews):
- "Waarom koopt een 65-jarige Belg nu Bitcoin?" (demographics + economics angle)
- "MiCA: wat betekent de EU crypto-wet concreet voor jou?" (regulation explainer — Belgian context)
- "Bitcoin als pensioenplan: gek idee of slimme strategie?" (opinion/authority)
- "De psychologie van crypto FOMO: hoe voorkom je slechte beslissingen?" (behavioral — universal)
- "Wat een hyperinflatieland ons leert over Bitcoin" (global economics + story hook)
- "Hoe belast België crypto anders dan de rest van Europa?" (Belgian-specific regulation)
- "Kraken vs Bybit voor gevorderde traders: een eerlijk oordeel" (money tier, platforms)
- "El Salvador twee jaar later: is bitcoin als nationale munt geslaagd?" (global politics)

REQUIREMENTS:
- All primary_keywords must be Dutch search queries
- title_suggestion must be Dutch, click-worthy, max 70 chars — make it shareable
- target_word_count: money=800-1200, authority=1000-1600, trend=600-900
- target_platforms: for money content, use exchange slugs; for editorial, can be empty []
- affiliate_focus: for editorial/authority content, set to "none" if no natural affiliate fit
- reasoning: why is this INTERESTING and UNIQUE — not just "it will convert"
- MANDATORY: Each brief must target a gap in the coverage map above
- MANDATORY: No two briefs can be variations of the same topic
- The best briefs make you think "I'd actually want to read that"
${marketResearch ? '- PRIORITIZE ⚡ content gap opportunities, especially editorial angles competitors miss' : ''}
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
    return `You are the editor-in-chief and content strategist for ShortNews (ShortNews.tech), a Dutch crypto media publication.

MISSION: Build the most trusted Dutch crypto publication — one that readers return to because it's genuinely interesting, honest, and covers stories no one else does. Affiliate revenue follows naturally from trust, not the other way around.

BLOG CONTEXT:
- Language: Dutch (nl) — written for a Belgian Flemish audience
- Primary audience: Belgian crypto readers (Flanders + Brussels) — traders, curious newcomers, investors, professionals
- Secondary audience: global Dutch-speaking crypto community
- Monetization: affiliate programs via /go/{slug} links (BitMEX, Bybit, Binance, Kraken) — trust-building content is equally important
- SEO focus: Belgian Dutch-language content that ranks because it's genuinely useful
- Content scope: GLOBAL — Belgian regulatory angle where relevant, but most crypto stories are universal

WHAT CRYPTO ACTUALLY COVERS (think this broadly):
- POLITICS: MiCA regulation, DNB/AFM oversight, EU digital euro (CBDC), government stances, election debates about crypto, geopolitical Bitcoin adoption (El Salvador, etc.)
- ECONOMICS: Bitcoin as inflation hedge, macro correlation, institutional flows (BlackRock, pension funds), store-of-value debate, economic inequality and crypto
- DEMOGRAPHICS & BEHAVIOR: generational trends (Gen Z vs Boomers), women in crypto, trading psychology (FOMO, loss aversion, overconfidence), Dutch/Belgian adoption statistics
- MARKET EVENTS: halvings, bull/bear cycle patterns, exchange collapses (lessons from FTX), liquidation cascades, protocol upgrades
- TECHNOLOGY & INNOVATION: DeFi, Layer 2 scaling, staking mechanics, Ethereum upgrades, Web3 real use cases
- EXCHANGE CONTENT: comparisons, reviews, fees, bonuses (legitimate but not the only vertical)

EDITORIAL PHILOSOPHY:
- A pure review site is boring and loses to aggregators. Be a PUBLICATION.
- Sometimes the most valuable article is an honest opinion piece or economic analysis with NO affiliate push
- Platform comparisons and reviews are important but should be ~40% of content, not 100%
- "Authority" content (education, analysis, opinion) builds the audience that eventually converts
- Ask: "Would a Dutch trader share this article with a friend?" If yes, it's worth writing.

BRIEF QUALITY STANDARDS:
- Each brief must have a genuinely distinct angle — not a variation of the same exchange review
- Prioritize unexplored territory: stories not yet told in Dutch
- Think like an editor who reads De Correspondent and wants to apply that quality to crypto
- Money content must feel natural, not forced — only push affiliate if it fits the story
- Authority and trend content are not consolation prizes — they build the brand

${(this.mergedConfig as any).tone ? `Tone preference: ${(this.mergedConfig as any).tone}` : ''}`;
  }
}
