/**
 * GET /api/admin/deployment-status
 *
 * Returns the status of post-deploy tasks so the dashboard can show
 * which actions still need to be run after a new deployment.
 *
 * Checks:
 *  1. migration   — latest DB schema applied (content_strategy_metrics table exists)
 *  2. metricsSync — article_metrics has synced data (any views > 0)
 *  3. agents      — at least one active agent is seeded
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/postgres.ts';

export const GET: APIRoute = async () => {
  try {
    // 1. Migration check — does the latest table (market_research) exist?
    const migrationRows = await query<{ ok: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'market_research'
      ) as ok
    `);
    const migrationOk = migrationRows[0]?.ok === true;

    // 2. Metrics sync check — published articles exist and at least one has views synced
    const syncRows = await query<{ total_published: number; synced_with_data: number }>(`
      SELECT
        (SELECT COUNT(*)::int FROM articles WHERE status = 'published') as total_published,
        (SELECT COUNT(*)::int FROM article_metrics WHERE views > 0) as synced_with_data
    `);
    const totalPublished = syncRows[0]?.total_published ?? 0;
    const syncedWithData = syncRows[0]?.synced_with_data ?? 0;
    // Sync is "ok" if: no published articles (nothing to sync) OR at least some data is present
    const syncOk = totalPublished === 0 || syncedWithData > 0;
    const syncDetail = totalPublished === 0
      ? 'Geen gepubliceerde artikelen'
      : `${syncedWithData}/${totalPublished} artikelen gesynchroniseerd`;

    // 3. Agents check — at least one active agent seeded
    const agentRows = await query<{ count: number }>(`
      SELECT COUNT(*)::int as count FROM agents WHERE is_active = true
    `);
    const agentCount = agentRows[0]?.count ?? 0;
    const agentsOk = agentCount > 0;

    return new Response(JSON.stringify({
      checks: [
        {
          id: 'migration',
          label: 'Database Migratie',
          description: migrationOk
            ? 'Alle tabellen aangemaakt (incl. market_research)'
            : 'market_research tabel ontbreekt — migratie vereist',
          ok: migrationOk,
          action: { method: 'POST', url: '/api/admin/migrate' },
          actionLabel: 'Migreer Nu',
        },
        {
          id: 'agents',
          label: 'Agent Seeding',
          description: agentsOk
            ? `${agentCount} actieve agent(en) aanwezig`
            : 'Geen agents gevonden — migratie uitvoeren',
          ok: agentsOk,
          action: { method: 'POST', url: '/api/admin/migrate' },
          actionLabel: 'Seed Agents',
        },
        {
          id: 'metricsSync',
          label: 'Analytics Synchronisatie',
          description: syncDetail,
          ok: syncOk,
          action: { method: 'POST', url: '/api/analytics/sync-metrics' },
          actionLabel: 'Sync Nu',
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[deployment-status] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      checks: [],
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
