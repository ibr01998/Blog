/**
 * GET /api/admin/agents  — List all agents ordered by role
 * POST /api/admin/agents — Create a new agent
 *
 * Protected by dashboard session cookie (via middleware.ts).
 */

import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db/postgres.ts';

export const GET: APIRoute = async () => {
  try {
    const agents = await query(
      `SELECT id, name, role, personality_config, behavior_overrides,
              performance_score, article_slots, is_active, created_at
       FROM agents
       ORDER BY role, performance_score DESC`
    );

    return new Response(JSON.stringify(agents), {
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { name, role, personality_config = {}, behavior_overrides = {}, article_slots = 1 } = body;

    if (!name || !role) {
      return new Response(JSON.stringify({ error: 'name and role are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validRoles = ['analyst', 'strategist', 'editor', 'writer', 'humanizer', 'seo'];
    if (!validRoles.includes(role)) {
      return new Response(JSON.stringify({ error: `role must be one of: ${validRoles.join(', ')}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await query(
      `INSERT INTO agents (name, role, personality_config, behavior_overrides, article_slots)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, role, JSON.stringify(personality_config), JSON.stringify(behavior_overrides), article_slots]
    );

    return new Response(JSON.stringify({ success: true, agent: result[0] }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
