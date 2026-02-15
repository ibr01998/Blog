/**
 * GET   /api/admin/agents/[id]  — Get single agent + recent logs
 * PUT   /api/admin/agents/[id]  — Full replacement update
 * PATCH /api/admin/agents/[id]  — Partial update (is_active, behavior_overrides, performance_score)
 *
 * Protected by dashboard session cookie (via middleware.ts).
 */

import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db/postgres.ts';

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;

  try {
    const agents = await query(
      `SELECT id, name, role, personality_config, behavior_overrides,
              performance_score, article_slots, is_active, created_at
       FROM agents WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (agents.length === 0) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get recent logs for this agent
    const logs = await query(
      `SELECT id, article_id, stage, input_summary, decision_summary, reasoning_summary, created_at
       FROM agent_logs
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );

    return new Response(JSON.stringify({ agent: agents[0], recent_logs: logs }), {
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

export const PUT: APIRoute = async ({ params, request }) => {
  const { id } = params;

  try {
    const body = await request.json();
    const { name, role, personality_config, behavior_overrides, article_slots, is_active, performance_score } = body;

    const result = await query(
      `UPDATE agents SET
        name = COALESCE($1, name),
        role = COALESCE($2, role),
        personality_config = COALESCE($3, personality_config),
        behavior_overrides = COALESCE($4, behavior_overrides),
        article_slots = COALESCE($5, article_slots),
        is_active = COALESCE($6, is_active),
        performance_score = COALESCE($7, performance_score)
       WHERE id = $8
       RETURNING *`,
      [
        name ?? null,
        role ?? null,
        personality_config ? JSON.stringify(personality_config) : null,
        behavior_overrides ? JSON.stringify(behavior_overrides) : null,
        article_slots ?? null,
        is_active ?? null,
        performance_score ?? null,
        id,
      ]
    );

    if (result.length === 0) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, agent: result[0] }), {
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

export const PATCH: APIRoute = async ({ params, request }) => {
  const { id } = params;

  try {
    const body = await request.json();

    // Build dynamic update — only update provided fields
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (body.is_active !== undefined) {
      updates.push(`is_active = $${paramIdx++}`);
      values.push(body.is_active);
    }
    if (body.behavior_overrides !== undefined) {
      // PATCH behavior_overrides: merge with existing (overrides win)
      updates.push(`behavior_overrides = behavior_overrides || $${paramIdx++}::jsonb`);
      values.push(JSON.stringify(body.behavior_overrides));
    }
    if (body.performance_score !== undefined) {
      updates.push(`performance_score = $${paramIdx++}`);
      values.push(body.performance_score);
    }
    if (body.personality_config !== undefined) {
      updates.push(`personality_config = $${paramIdx++}`);
      values.push(JSON.stringify(body.personality_config));
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid fields to update' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    values.push(id);
    const result = await query(
      `UPDATE agents SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (result.length === 0) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, agent: result[0] }), {
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
