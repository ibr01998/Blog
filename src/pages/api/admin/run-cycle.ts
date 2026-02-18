/**
 * POST /api/admin/run-cycle
 *
 * Triggers a full autonomous editorial cycle:
 * Analyst → Strategist → Editor → Writer → Humanizer → SEO → Save drafts
 *
 * Streams progress via Server-Sent Events (SSE) so the dashboard can show
 * a live progress bar and log feed. Falls back to JSON for cron/Bearer callers.
 *
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

/**
 * Shared handler logic for both GET (Vercel cron) and POST (manual trigger)
 */
async function handleCycle(request: Request): Promise<Response> {
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
          const summary = await runEditorialCycle((evt) => {
            send('progress', evt);
          });

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
}

// Export both GET (for Vercel cron) and POST (for manual dashboard triggers)
export const GET: APIRoute = async ({ request }) => handleCycle(request);
export const POST: APIRoute = async ({ request }) => handleCycle(request);
