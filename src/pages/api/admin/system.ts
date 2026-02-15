/**
 * GET /api/admin/system  — Fetch system_config (singleton row id=1)
 * PUT /api/admin/system  — Update system_config fields
 *
 * Protected by dashboard session cookie (via middleware.ts).
 */

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/postgres.ts';

interface SystemConfig {
  id: number;
  system_paused: boolean;
  auto_publish_enabled: boolean;
  max_articles_per_week: number;
  enable_multi_agent: boolean;
  enable_auto_evolution: boolean;
}

export const GET: APIRoute = async () => {
  try {
    const rows = await query<SystemConfig>('SELECT * FROM system_config WHERE id = 1 LIMIT 1');

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: 'system_config not found. Run /api/admin/migrate first.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(rows[0]), {
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

export const PUT: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as Partial<SystemConfig>;

    const {
      system_paused,
      auto_publish_enabled,
      max_articles_per_week,
      enable_multi_agent,
      enable_auto_evolution,
    } = body;

    await query(
      `UPDATE system_config SET
        system_paused = COALESCE($1, system_paused),
        auto_publish_enabled = COALESCE($2, auto_publish_enabled),
        max_articles_per_week = COALESCE($3, max_articles_per_week),
        enable_multi_agent = COALESCE($4, enable_multi_agent),
        enable_auto_evolution = COALESCE($5, enable_auto_evolution)
       WHERE id = 1`,
      [
        system_paused ?? null,
        auto_publish_enabled ?? null,
        max_articles_per_week ?? null,
        enable_multi_agent ?? null,
        enable_auto_evolution ?? null,
      ]
    );

    const updated = await query<SystemConfig>('SELECT * FROM system_config WHERE id = 1 LIMIT 1');

    return new Response(JSON.stringify({ success: true, config: updated[0] }), {
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
