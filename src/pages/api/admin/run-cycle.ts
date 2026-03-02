/**
 * POST /api/admin/run-cycle
 *
 * Triggers a full autonomous editorial cycle:
 * Analyst → Strategist Governor → Briefs → Editor → Writer → Humanizer →
 * FactChecker (retry loop) → SEO → Images → Visual Inspector → Auto-Publish
 *
 * Streams progress via Server-Sent Events (SSE) so the dashboard can show
 * a live progress bar and log feed. Falls back to JSON for cron/Bearer callers.
 *
 * Manual triggers bypass the adaptive scheduling timestamp guard.
 * Cron jobs respect the next_run_timestamp from the Strategist Governor.
 *
 * Auth: accepts EITHER
 *   - Dashboard session cookie (for manual triggers from /dashboard/system)
 *   - Authorization: Bearer <CRON_SECRET> header (for Vercel Cron Jobs)
 */

import type { APIRoute } from 'astro';
import { runEditorialCycle } from '../../../lib/orchestrator.ts';

// CRITICAL: The full cycle makes ~10-20 AI API calls (includes fact-check retries + visual inspection).
// Requires Vercel Pro plan (max 300s). Hobby plan limit is 60s.
export const config = { maxDuration: 300 };

/**
 * Shared handler logic for both GET (Vercel cron) and POST (manual trigger)
 */
async function handleCycle(request: Request): Promise<Response> {
  // Check CRON_SECRET for Vercel Cron triggers (middleware may already handle session)
  const cronSecret = (import.meta as any).env?.CRON_SECRET ?? process.env.CRON_SECRET;
  const cookieHeader = request.headers.get('cookie');
  const hasSession = cookieHeader?.includes('dashboard_session=');

  if (cronSecret) {
    const authHeader = request.headers.get('authorization');

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

  // Manual triggers (dashboard session) bypass the adaptive scheduling timestamp
  // Cron jobs should respect the Strategist Governor's next_run_timestamp
  const isManualTrigger = !!hasSession;

  // Determine if caller wants SSE (browser dashboard) or plain JSON (cron job)
  const acceptHeader = request.headers.get('accept') ?? '';
  const wantsSSE = acceptHeader.includes('text/event-stream');

  const startTime = Date.now();

  if (wantsSSE) {
    // ── SSE streaming mode ──────────────────────────────────────────────────
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: Record<string, unknown>) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
          const summary = await runEditorialCycle(
            (evt) => { send('progress', evt); },
            { skipTimestampGuard: isManualTrigger },
          );

          send('done', {
            success: true,
            duration_ms: Date.now() - startTime,
            summary,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('[run-cycle] Error:', errorMessage);
          send('error', {
            success: false,
            duration_ms: Date.now() - startTime,
            error: errorMessage,
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // ── JSON mode (cron jobs, API callers) ──────────────────────────────────
  try {
    const summary = await runEditorialCycle(
      undefined,
      { skipTimestampGuard: isManualTrigger },
    );

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

    return new Response(JSON.stringify({
      success: false,
      duration_ms: Date.now() - startTime,
      error: errorMessage,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Export both GET (for Vercel cron) and POST (for manual dashboard triggers)
export const GET: APIRoute = async ({ request }) => handleCycle(request);
export const POST: APIRoute = async ({ request }) => handleCycle(request);

