/**
 * ResearchAgent — daily external market research via Tavily API.
 *
 * Responsibilities:
 *  - Execute 5 Dutch crypto search queries against Tavily (parallel)
 *  - Use gpt-4o-mini to extract structured insights from raw results
 *  - Store results in market_research table (one row per research run)
 *  - Log to agent_logs (stage: 'researcher:report')
 *
 * Called by: /api/admin/run-research (daily cron at 02:00 UTC + manual trigger)
 * Consumed by: StrategistAgent (reads latest row within 7 days)
 *
 * Tavily free tier: 1000 calls/month. 5 queries/day × 31 days = 155/month.
 */

import { z } from 'zod';
import { BaseAgent } from './base.ts';
import { query } from '../db/postgres.ts';
import type { AgentRecord } from './types.ts';

// ── Dutch crypto search queries sent to Tavily ────────────────────────────────
const DUTCH_RESEARCH_QUERIES = [
  'beste crypto exchange nederland 2026',
  'bybit review ervaringen nederland',
  'bitcoin trading beginners nederland',
  'crypto staking vergelijking 2026',
  'binance vs kraken kosten nederland',
];

// ── Zod schema for structured LLM extraction ─────────────────────────────────
const MarketInsightsSchema = z.object({
  trending_topics: z.array(z.object({
    keyword: z.string(),
    trend_score: z.number().min(0).max(1),
    reason: z.string(),
  })).max(8),
  keyword_opportunities: z.array(z.object({
    keyword: z.string().describe('Dutch search query'),
    content_gap: z.boolean(),
    suggested_angle: z.string(),
    suggested_format: z.enum(['comparison', 'review', 'bonus', 'trust', 'fee', 'guide']),
    suggested_hook: z.enum(['fear', 'curiosity', 'authority', 'benefit', 'story']),
  })).max(10),
  competitor_patterns: z.object({
    common_title_patterns: z.array(z.string()).max(5),
    popular_formats: z.array(z.string()).max(5),
    avg_article_approach: z.string(),
  }),
  recommended_keywords: z.array(z.string()).max(10),
  insights_summary: z.string().max(500),
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

    // 2. Compact text summary for LLM
    const searchSummary = successful.map((r) =>
      `QUERY: "${r.query}"\n` +
      r.results.map((a, i) =>
        `  ${i + 1}. "${a.title}" (${a.url})\n     ${a.content.substring(0, 220)}`
      ).join('\n')
    ).join('\n\n---\n\n');

    // 3. Structured extraction via LLM
    const insights = await this.callObject({
      schema: MarketInsightsSchema,
      model: 'gpt-4o-mini',
      systemPrompt: `You are a market research analyst for ShortNews.tech, a Dutch crypto affiliate blog.
Extract actionable intelligence from competitor search results.
Target market: Netherlands and Belgium (NL/BE).
Affiliate platforms: Bybit, BitMEX, Binance, Kraken.
Focus on: content gaps, trending Dutch search queries, patterns in top-ranking competitor articles.`,
      userPrompt: `Analyze these Dutch crypto search results from Tavily (top-ranking competitor articles).

${searchSummary}

Extract:
1. trending_topics — keywords appearing across multiple competitors (trend_score 0-1)
2. keyword_opportunities — Dutch queries we could target; set content_gap=true when competitors cover it poorly or not at all
3. competitor_patterns — common title formats and article structures used by top rankers
4. recommended_keywords — 5-10 exact Dutch search phrases for our next editorial cycle
5. insights_summary — 2-3 actionable takeaways in max 500 chars

Recommended keywords must be exact Dutch search queries a Dutch/Belgian trader would Google.`,
      maxTokens: 1500,
    });

    // 4. Persist to market_research table
    await query(
      `INSERT INTO market_research
         (research_date, search_results, trending_topics, keyword_opportunities,
          competitor_patterns, recommended_keywords, insights_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        today,
        JSON.stringify({ queries: DUTCH_RESEARCH_QUERIES, raw: successful }),
        JSON.stringify(insights.trending_topics),
        JSON.stringify(insights.keyword_opportunities),
        JSON.stringify(insights.competitor_patterns),
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
        research_date: today,
      },
      decisionSummary: {
        trending_topics_found: insights.trending_topics.length,
        keyword_opportunities_found: insights.keyword_opportunities.length,
        content_gaps: insights.keyword_opportunities.filter((k) => k.content_gap).length,
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
          search_depth: 'basic',
          max_results: 5,
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
