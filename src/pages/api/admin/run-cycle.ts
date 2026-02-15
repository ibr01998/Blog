/**
 * POST /api/admin/run-cycle
 *
 * Triggers a full autonomous editorial cycle:
 * Analyst → Strategist → Editor → Writer → Humanizer → SEO → Save drafts
 *
 * Returns a CycleSummary JSON object.
 * This endpoint can take 30-120 seconds — requires Vercel Pro for maxDuration=300.
 *
 * Auth: accepts EITHER
 *   - Dashboard session cookie (for manual triggers from /dashboard/system)
 *   - Authorization: Bearer <CRON_SECRET> header (for Vercel Cron Jobs)
 *
 * Protected by dashboard session cookie via middleware.ts for /api/admin/* routes.
 * The CRON_SECRET bypass is checked BEFORE middleware (see middleware.ts update).
 */

import type { APIRoute } from 'astro';
import { runEditorialCycle } from '../../../lib/orchestrator.ts';

// CRITICAL: The full cycle makes ~8-15 OpenAI API calls (reduced with gpt-4o-mini).
// Requires Vercel Pro plan (max 300s). Hobby plan limit is 60s.
export const config = { maxDuration: 300 };

export const POST: APIRoute = async ({ request }) => {
  // Check CRON_SECRET for Vercel Cron triggers (middleware may already handle session)
  const cronSecret = (import.meta as any).env?.CRON_SECRET ?? process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const cookieHeader = request.headers.get('cookie');
    const hasSession = cookieHeader?.includes('dashboard_session=');

    // If no session cookie, require Bearer token
    if (!hasSession) {
      if (authHeader !== `Bearer ${cronSecret}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  const startTime = Date.now();

  try {
    const summary = await runEditorialCycle();

    return new Response(JSON.stringify({
      success: true,
      duration_ms: Date.now() - startTime,
      summary,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[run-cycle] Error:', errorMessage);

    // Return 200 with error details so the UI can display the reason
    return new Response(JSON.stringify({
      success: false,
      duration_ms: Date.now() - startTime,
      error: errorMessage,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
