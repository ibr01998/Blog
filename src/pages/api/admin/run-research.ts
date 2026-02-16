/**
 * POST /api/admin/run-research
 *
 * Triggers the ResearchAgent: fetches Tavily data and stores market insights.
 *
 * Auth: Bearer <CRON_SECRET> header OR dashboard session cookie.
 * Idempotent: if research already ran today, returns the cached result (no duplicate insert).
 *
 * Called by:
 *  - Vercel Cron at 02:00 UTC daily (vercel.json)
 *  - Dashboard "Run Nu" button (manual trigger from system.astro)
 */

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/postgres.ts';
import { BaseAgent } from '../../../lib/agents/base.ts';
import { ResearchAgent } from '../../../lib/agents/researcher.ts';

export const config = { maxDuration: 120 };

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now();

  // ── Auth: Bearer token (cron) OR session cookie (dashboard) ──────────────
  const cronSecret = process.env.CRON_SECRET ?? (import.meta as any).env?.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const cookieHeader = request.headers.get('cookie') ?? '';
    const hasSession = cookieHeader.includes('dashboard_session=');

    if (!hasSession && authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    // ── Check system_config: is research agent enabled? ───────────────────
    const configRows = await query<{ enable_research_agent: boolean }>(
      'SELECT enable_research_agent FROM system_config WHERE id = 1 LIMIT 1'
    );
    if (configRows[0] && configRows[0].enable_research_agent === false) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Research agent is disabled. Enable it via System settings.',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Idempotency: already ran today? ──────────────────────────────────
    const existing = await query<{
      research_date: string;
      insights_summary: string;
      recommended_keywords: string[];
    }>(
      `SELECT research_date, insights_summary, recommended_keywords
       FROM market_research WHERE research_date = $1 LIMIT 1`,
      [today]
    );

    if (existing.length > 0) {
      const cached = existing[0];
      return new Response(JSON.stringify({
        success: true,
        cached: true,
        date: cached.research_date,
        insights_summary: cached.insights_summary,
        keywords_found: cached.recommended_keywords?.length ?? 0,
        duration_ms: Date.now() - startTime,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Run the ResearchAgent ────────────────────────────────────────────
    const agentRecord = await BaseAgent.loadByRole('researcher');
    const agent = new ResearchAgent(agentRecord);
    const result = await agent.run();

    return new Response(JSON.stringify({
      success: true,
      cached: false,
      date: result.date,
      insights_summary: result.insights_summary,
      keywords_found: result.keywords_found,
      duration_ms: Date.now() - startTime,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[run-research] Error:', errorMessage);

    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      duration_ms: Date.now() - startTime,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};
