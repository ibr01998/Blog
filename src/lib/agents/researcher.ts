/**
 * ResearchAgent — daily external market research via Tavily API.
 *
 * Responsibilities:
 *  - Execute 16 Dutch crypto search queries against Tavily (parallel, advanced depth)
 *  - Use gpt-4o-mini to extract structured insights from raw results
 *  - Store results in market_research table (one row per research run)
 *  - Log to agent_logs (stage: 'researcher:report')
 *
 * Called by: /api/admin/run-research (daily cron at 02:00 UTC + manual trigger)
 * Consumed by: StrategistAgent (reads latest row within 7 days)
 *
 * Tavily credit usage:
 *   16 queries × 2 credits (advanced) × 31 days ≈ 992 credits/month
 *   Free tier limit: 1000 credits/month
 */

import { z } from 'zod';
import { BaseAgent } from './base.ts';
import { query } from '../db/postgres.ts';
import type { AgentRecord } from './types.ts';

// ── Rotating query pool: 10 categories × 5 queries = 50 total ────────────────
// Each day selects 16 queries deterministically (1 per category + 6 rotating extras)
// This ensures daily variety while staying within Tavily's ~1000 credit/month free tier.
const QUERY_POOL: { category: string; queries: string[] }[] = [
  {
    category: 'exchange_comparison',
    queries: [
      'beste crypto exchange nederland 2026',
      'bybit vs binance nederland kosten vergelijking',
      'kraken vs coinbase nederland review',
      'bitmex review betrouwbaar nederland 2026',
      'crypto exchange fees vergelijking belgie nederland',
    ],
  },
  {
    category: 'platform_deepdive',
    queries: [
      'bybit ervaringen nederlanders 2026',
      'binance storten kosten nederland uitleg',
      'kraken staking opbrengst percentage 2026',
      'bitmex leverage trading uitleg veiligheid',
      'binance proof of reserves audit 2026',
    ],
  },
  {
    category: 'trading_strategy',
    queries: [
      'crypto leverage trading beginners nederland fouten',
      'dollar cost averaging bitcoin strategie resultaten',
      'crypto trading psychologie angst hebzucht',
      'technische analyse bitcoin ethereum beginners',
      'crypto portfolio risicospreiding strategie',
    ],
  },
  {
    category: 'dutch_regulations',
    queries: [
      'crypto belasting nederland 2026 aangifte box3',
      'AFM crypto regulering toezicht nieuws 2026',
      'MiCA verordening europa crypto impact nederland',
      'crypto witboek registratie dnb nederland',
      'crypto fiscaal voordeel belgie vs nederland',
    ],
  },
  {
    category: 'bitcoin_economics',
    queries: [
      'bitcoin als inflatie hedge 2026 nederland',
      'bitcoin halving effect prijs historisch analyse',
      'institutionele bitcoin adoptie blackrock fidelity',
      'bitcoin ETF spot goedkeuring markt impact',
      'bitcoin vs goud store of value vergelijking',
    ],
  },
  {
    category: 'crypto_politics',
    queries: [
      'crypto regulering europa MiCA 2026 gevolgen',
      'el salvador bitcoin wet resultaten evaluatie',
      'SEC crypto handhaving usa impact europese markt',
      'digitale euro CBDC dnb nederland 2026',
      'crypto politiek partijen standpunten nederland',
    ],
  },
  {
    category: 'demographics_behavior',
    queries: [
      'jongeren crypto investeren nederland generatie z',
      'vrouwen crypto markt groeiende deelname studie',
      'pensioenfondsen bitcoin institutionele adoptie europa',
      'crypto fomo angst beslissingen psychologie onderzoek',
      'nederlanders crypto eigendom statistieken 2026',
    ],
  },
  {
    category: 'market_events',
    queries: [
      'bitcoin koers analyse 2026 vooruitzichten',
      'crypto markt crash oorzaken herstel historisch',
      'altcoin seizoen signalen indicators 2026',
      'crypto winter overleven strategie lessen',
      'bitcoin dominantie altseason correlatie analyse',
    ],
  },
  {
    category: 'defi_web3_innovation',
    queries: [
      'defi yield farming nederland belasting 2026',
      'ethereum layer 2 scaling uitleg kosten vergelijking',
      'crypto staking beste opbrengst vergelijking 2026',
      'web3 adoptie nederland bedrijven projecten',
      'NFT markt status nederland 2026 realiteit',
    ],
  },
  {
    category: 'global_macro_crypto',
    queries: [
      'bitcoin global adoption developing countries',
      'crypto remittances internationale geldovermakingen',
      'microstrategy bitcoin bedrijfsstrategie analyse',
      'crypto venture capital investeringen trends 2026',
      'hyperinflatie landen crypto vlucht gebruik',
    ],
  },
];

/**
 * Selects 16 diverse queries per day using day-of-year as rotation seed.
 * Guarantees at least 1 query from each of the 10 categories, then fills
 * remaining 6 slots with a second rotation through high-priority categories.
 */
function selectDailyQueries(): string[] {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86_400_000);

  const selected: string[] = [];

  // Pass 1: 1 query from each category (10 queries)
  for (let i = 0; i < QUERY_POOL.length; i++) {
    const cat = QUERY_POOL[i];
    selected.push(cat.queries[(dayOfYear + i) % cat.queries.length]);
  }

  // Pass 2: 6 more from rotating through all categories (picks the next query)
  for (let extra = 0; selected.length < 16; extra++) {
    const cat = QUERY_POOL[extra % QUERY_POOL.length];
    const candidate = cat.queries[(dayOfYear + Math.floor(extra / QUERY_POOL.length) + 1) % cat.queries.length];
    if (!selected.includes(candidate)) selected.push(candidate);
  }

  return selected;
}

// ── Zod schema for structured LLM extraction ─────────────────────────────────
const MarketInsightsSchema = z.object({
  trending_topics: z.array(z.object({
    keyword: z.string(),
    trend_score: z.number().min(0).max(1),
    reason: z.string(),
  })).max(15),
  keyword_opportunities: z.array(z.object({
    keyword: z.string().describe('Exact Dutch search query a trader would Google'),
    content_gap: z.boolean().describe('true = competitors cover this poorly or not at all'),
    suggested_angle: z.string().describe('Unique editorial angle for ShortNews'),
    suggested_format: z.enum(['comparison', 'review', 'bonus', 'trust', 'fee', 'guide']),
    suggested_hook: z.enum(['fear', 'curiosity', 'authority', 'benefit', 'story']),
    estimated_competition: z.enum(['low', 'medium', 'high']).describe('Ranking difficulty estimate'),
  })).max(20),
  competitor_patterns: z.object({
    common_title_patterns: z.array(z.string()).max(8)
      .describe('Title templates that appear repeatedly, e.g. "X vs Y: Welke is Beter in 2026?"'),
    popular_formats: z.array(z.string()).max(8)
      .describe('Article structures that dominate (e.g. "numbered list review", "comparison table")'),
    avg_article_approach: z.string()
      .describe('1-2 sentences on how top-ranking Dutch crypto articles are structured'),
    missing_angles: z.array(z.string()).max(5)
      .describe('Angles or topics present in English but absent in Dutch — big opportunities'),
  }),
  high_performing_titles: z.array(z.string()).max(15)
    .describe('Actual competitor article titles that appear highly ranked — use as inspiration'),
  recommended_keywords: z.array(z.string()).max(20)
    .describe('Exact Dutch search phrases for the next editorial cycle, sorted by opportunity'),
  insights_summary: z.string().max(800)
    .describe('3-5 actionable takeaways for the content team, in Dutch or English'),
});

type TavilyResult = { title: string; url: string; content: string; score?: number };
type TavilyResponse = { query: string; results: TavilyResult[] };

export class ResearchAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  async run(): Promise<{ date: string; insights_summary: string; keywords_found: number }> {
    const today = new Date().toISOString().split('T')[0];
    const apiKey = process.env.TAVILY_API_KEY ?? (import.meta as any).env?.TAVILY_API_KEY;
    if (!apiKey) throw new Error('TAVILY_API_KEY is not set.');

    // 1. Select today's 16 queries from the rotating pool
    const dailyQueries = selectDailyQueries();

    // 2. Fetch Tavily in parallel — null on failure, don't break the batch
    const rawResults = await Promise.all(
      dailyQueries.map((q) => this.fetchTavily(q, apiKey))
    );
    const successful = rawResults.filter((r): r is TavilyResponse => r !== null);
    if (successful.length === 0) throw new Error('All Tavily calls failed — check API key and quota.');

    // 2. Compact text summary for LLM — include more content per result for depth
    const searchSummary = successful.map((r) =>
      `### QUERY: "${r.query}"\n` +
      r.results.map((a, i) =>
        `  ${i + 1}. "${a.title}"\n     URL: ${a.url}\n     ${a.content.substring(0, 350)}`
      ).join('\n')
    ).join('\n\n---\n\n');

    // 3. Structured extraction via LLM
    const insights = await this.callObject({
      schema: MarketInsightsSchema,
      model: 'gpt-4o-mini',
      systemPrompt: `You are a senior editorial research analyst for ShortNews.tech, a Dutch crypto media publication.

Your job: discover genuinely interesting, UNIQUE editorial opportunities across the full spectrum of crypto topics.

ShortNews covers crypto holistically — not just exchange reviews. Crypto intersects with:
- POLITICS: government regulation, central bank digital currencies, election stances on crypto, geopolitical Bitcoin adoption
- ECONOMICS: inflation hedging, institutional flows, macro correlation, store-of-value debate, developing-world adoption
- DEMOGRAPHICS & BEHAVIOR: generational wealth transfer into crypto, women in crypto, trading psychology, FOMO/FUD patterns, Dutch/Belgian adoption rates
- MARKET EVENTS: halvings, bull/bear cycles, major liquidations, protocol upgrades, exchange collapses
- TECHNOLOGY: DeFi, Layer 2, Ethereum upgrades, staking, Web3 real-world adoption
- EXCHANGE CONTENT: comparisons, reviews, fees, bonuses (important but NOT the only vertical)

The blog monetizes via affiliate programs (Bybit, BitMEX, Binance, Kraken) BUT a trusted, authoritative editorial voice builds long-term audience that converts far better than pure promotion.
Content goal: be the go-to Dutch crypto source that readers trust — THEN they click affiliate links.

Today's research covers ${successful.length} queries across these topics. Extract the most interesting, timely, and UNIQUE angles.`,
      userPrompt: `Analyze these ${successful.length} search queries and their results. Today's queries deliberately span exchange reviews, politics, economics, demographics, market events, and innovation.

${searchSummary}

Extract with maximum specificity — AVOID generic crypto observations, find the SURPRISING and SPECIFIC:

1. **trending_topics** (up to 15): What's actually resonating right now? Include political/economic/behavioral topics, not just exchange news. Score 0-1 based on recency and cross-query frequency.

2. **keyword_opportunities** (up to 20): Dutch search queries we could own. Actively look for:
   - content_gap=true: topics underserved in Dutch (English content exists, Dutch doesn't)
   - NON-AFFILIATE opportunities: regulation explainers, economic analysis, behavioral guides
   - Affiliate-adjacent: topics that naturally lead to exchange recommendations
   - Niche: specific demographics (gepensioneerden in crypto, studenten DCA, etc.)

3. **competitor_patterns**:
   - Exact title templates top rankers use
   - What article types dominate: pure review sites vs editorial vs news?
   - Missing angles: political/economic/behavioral stories competitors miss entirely
   - What differentiates top Dutch crypto content from generic content?

4. **high_performing_titles** (up to 15): Real competitor titles — include editorial pieces, not just reviews.

5. **recommended_keywords** (up to 20): Mix of:
   - 8-10 editorial/informational keywords (politics, economics, behavior, market analysis)
   - 6-8 affiliate-intent keywords (comparisons, reviews with purchase intent)
   - 2-4 trend/timely keywords (things happening right now)

6. **insights_summary** (max 800 chars): What's the most INTERESTING story in crypto right now for Dutch readers? What unique editorial angle can ShortNews own that competitors are missing?

Be specific. Surprising beats obvious. Editorial beats promotional.`,
      maxTokens: 2500,
    });

    // 4. Persist to market_research table
    await query(
      `INSERT INTO market_research
         (research_date, search_results, trending_topics, keyword_opportunities,
          competitor_patterns, recommended_keywords, insights_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        today,
        JSON.stringify({
          queries: DUTCH_RESEARCH_QUERIES,
          queries_succeeded: successful.length,
          high_performing_titles: insights.high_performing_titles,
          raw: successful,
        }),
        JSON.stringify(insights.trending_topics),
        JSON.stringify(insights.keyword_opportunities),
        JSON.stringify({
          ...insights.competitor_patterns,
          high_performing_titles: insights.high_performing_titles,
        }),
        insights.recommended_keywords,
        insights.insights_summary,
      ]
    );

    // 5. Log to agent_logs
    await this.log({
      articleId: null,
      stage: 'researcher:report',
      inputSummary: {
        queries_attempted: dailyQueries.length,
        queries_selected: dailyQueries,
        queries_succeeded: successful.length,
        results_per_query: 10,
        search_depth: 'advanced',
        credits_used: successful.length * 2,
        research_date: today,
        categories_covered: QUERY_POOL.map(c => c.category),
      },
      decisionSummary: {
        trending_topics_found: insights.trending_topics.length,
        keyword_opportunities_found: insights.keyword_opportunities.length,
        content_gaps: insights.keyword_opportunities.filter((k) => k.content_gap).length,
        low_competition: insights.keyword_opportunities.filter((k) => k.estimated_competition === 'low').length,
        high_performing_titles_found: insights.high_performing_titles.length,
        recommended_keywords: insights.recommended_keywords,
      },
      reasoningSummary: insights.insights_summary,
    });

    return {
      date: today,
      insights_summary: insights.insights_summary,
      keywords_found: insights.recommended_keywords.length,
    };
  }

  private async fetchTavily(q: string, apiKey: string): Promise<TavilyResponse | null> {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: q,
          search_depth: 'advanced',
          max_results: 10,
          include_answer: false,
          include_raw_content: false,
        }),
      });

      if (!res.ok) {
        console.warn(`[ResearchAgent] Tavily HTTP ${res.status} for "${q}"`);
        return null;
      }

      const data = await res.json() as { results?: TavilyResult[] };
      return { query: q, results: data.results ?? [] };
    } catch (err) {
      console.warn(`[ResearchAgent] Tavily fetch failed for "${q}":`, err);
      return null;
    }
  }
}
