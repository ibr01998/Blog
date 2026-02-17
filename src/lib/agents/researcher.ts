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

// ── 16 Dutch crypto search queries — covers all content verticals ─────────────
const DUTCH_RESEARCH_QUERIES = [
  // Exchange comparisons & best-of
  'beste crypto exchange nederland 2026',
  'bybit vs binance nederland kosten vergelijking',
  'kraken vs coinbase nederland review',
  'bitmex review betrouwbaar nederland 2026',

  // Platform deep dives
  'bybit ervaringen nederlanders 2026',
  'binance storten kosten nederland uitleg',
  'kraken staking opbrengst percentage 2026',
  'bitmex leverage trading beginners uitleg',

  // Trading strategies & guides
  'crypto leverage trading beginners nederland',
  'bitcoin futures platform vergelijking nederland',
  'crypto portfolio opbouwen strategie nederland',

  // Staking / DeFi / yield
  'crypto staking vergelijking beste opbrengst 2026',
  'defi yield farming nederland uitleg belasting',

  // Dutch market / regulatory / news
  'crypto belasting nederland 2026 aangifte',
  'crypto kopen nederland veilig beginners gids',
  'beste crypto app nederland 2026 vergelijking',
];

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

    // 1. Fetch Tavily in parallel — null on failure, don't break the batch
    const rawResults = await Promise.all(
      DUTCH_RESEARCH_QUERIES.map((q) => this.fetchTavily(q, apiKey))
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
      systemPrompt: `You are a senior market research analyst for ShortNews.tech, a Dutch crypto affiliate blog.
Your job: extract deep, actionable competitive intelligence from Tavily search results.

Context:
- Blog language: Dutch (nl)
- Target audience: Dutch and Belgian crypto traders
- Monetization: affiliate programs for Bybit, BitMEX, Binance, Kraken via /go/{slug}
- SEO market: NL/BE Dutch-language search
- Content goal: outrank competitors and drive affiliate conversions

You have access to ${successful.length} search queries with up to 10 results each — this is rich, comprehensive data.
Analyse ALL results deeply before extracting insights.`,
      userPrompt: `Deeply analyze these ${successful.length} Dutch crypto search queries and their top-ranking competitor results.

${searchSummary}

Extract the following with maximum depth and specificity:

1. **trending_topics** (up to 15): Keywords/themes appearing across multiple queries. Score 0-1 based on frequency and recency signals. Include the reason why it's trending.

2. **keyword_opportunities** (up to 20): Dutch search queries we could target. Prioritize:
   - content_gap=true: topics where results are thin, outdated, or in English only
   - Low competition niches competitors are ignoring
   - Long-tail queries with clear affiliate intent (comparison/review)

3. **competitor_patterns**:
   - Exact title templates used by top rankers (preserve the pattern, e.g. "Beste X voor Y in 2026 [Top 5]")
   - Article formats that dominate (numbered lists, tables, step-by-step guides)
   - What makes Dutch crypto content rank: length, freshness, structure?
   - Missing angles: topics covered in English/globally but absent in Dutch — major gaps

4. **high_performing_titles** (up to 15): Copy the actual titles of well-ranked competitor articles. These are direct inspiration for our editorial team.

5. **recommended_keywords** (up to 20): Exact Dutch phrases for our next editorial cycle. Sort by opportunity score (gap × intent × volume estimate). Include a mix: some easy wins and some strategic long-term bets.

6. **insights_summary** (max 800 chars): 3-5 concrete, actionable takeaways the editor-in-chief should act on immediately.

Be specific. Avoid generic observations. Base everything on the actual search results provided.`,
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
        queries_attempted: DUTCH_RESEARCH_QUERIES.length,
        queries_succeeded: successful.length,
        results_per_query: 10,
        search_depth: 'advanced',
        credits_used: successful.length * 2,
        research_date: today,
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
