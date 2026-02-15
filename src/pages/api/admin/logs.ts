/**
 * GET /api/admin/logs
 *
 * Returns paginated agent_logs with agent name.
 * Query params:
 *   - agent_id: UUID (optional)
 *   - article_id: UUID (optional)
 *   - stage: string (optional) e.g. 'analyst:report', 'evolution:suggestion'
 *   - limit: number (default 50, max 200)
 *   - offset: number (default 0)
 *
 * Protected by dashboard session cookie (via middleware.ts).
 */

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/postgres.ts';

/**
 * PATCH /api/admin/logs — mark a log entry's stage (e.g. evolution:suggestion → evolution:applied)
 * Body: { id: string, stage: string }
 */
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const { id, stage } = await request.json();
    if (!id || !stage) {
      return new Response(JSON.stringify({ error: 'id and stage are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const result = await query(
      `UPDATE agent_logs SET stage = $1 WHERE id = $2 RETURNING id, stage`,
      [stage, id]
    );
    if (result.length === 0) {
      return new Response(JSON.stringify({ error: 'Log not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true, log: result[0] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async ({ url }) => {
  try {
    const params = url.searchParams;
    const agentId = params.get('agent_id');
    const articleId = params.get('article_id');
    const stage = params.get('stage');
    const limit = Math.min(parseInt(params.get('limit') ?? '50'), 200);
    const offset = parseInt(params.get('offset') ?? '0');

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (agentId) {
      conditions.push(`al.agent_id = $${paramIdx++}`);
      values.push(agentId);
    }
    if (articleId) {
      conditions.push(`al.article_id = $${paramIdx++}`);
      values.push(articleId);
    }
    if (stage) {
      conditions.push(`al.stage ILIKE $${paramIdx++}`);
      values.push(`%${stage}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_logs al ${where}`,
      values
    );
    const total = parseInt(countRows[0]?.count ?? '0');

    const logs = await query(
      `SELECT
         al.id, al.agent_id, al.article_id, al.stage,
         al.input_summary, al.decision_summary, al.reasoning_summary,
         al.created_at,
         ag.name as agent_name, ag.role as agent_role
       FROM agent_logs al
       LEFT JOIN agents ag ON al.agent_id = ag.id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    );

    return new Response(JSON.stringify({ logs, total, limit, offset }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
