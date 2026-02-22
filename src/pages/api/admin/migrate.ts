/**
 * POST /api/admin/migrate
 *
 * One-time setup endpoint that:
 *   1. Creates all new Postgres tables (idempotent — IF NOT EXISTS)
 *   2. Seeds initial agent records
 *   3. Seeds affiliate_links from static registry
 *
 * Protected by the dashboard session cookie (via middleware.ts).
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING for seed data.
 */

import type { APIRoute } from 'astro';
import { query, MIGRATION_SQL, SEED_AGENTS, SEED_AFFILIATE_LINKS } from '../../../lib/db/postgres.ts';
import { db } from 'astro:db';
import { sql as drizzleSql } from 'drizzle-orm';

export const config = { maxDuration: 60 };

export const POST: APIRoute = async () => {
  try {
    // 1. Run migration SQL (CREATE TABLE IF NOT EXISTS, indexes, etc.)
    // Split on semicolons and run each statement individually.
    // Strip comment lines per-statement to handle multi-line blocks with leading comments.
    const statements = MIGRATION_SQL
      .split(';')
      .map((s) => {
        // Remove lines that are pure SQL comments (-- ...) within each statement chunk
        return s.split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim();
      })
      .filter((s) => s.length > 0);

    const results: string[] = [];
    for (const stmt of statements) {
      try {
        await query(stmt);
        // Extract name for reporting
        const match = stmt.match(/(?:CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|CREATE EXTENSION IF NOT EXISTS|ALTER TABLE)\s+(?:vector\s+)?(?:"?(\w+)"?)/i);
        if (match?.[1]) results.push(match[1]);
        else results.push(stmt.substring(0, 40).replace(/\s+/g, ' ') + '…');
      } catch (stmtErr) {
        const msg = stmtErr instanceof Error ? stmtErr.message : String(stmtErr);
        // Ignore "already exists" type errors for idempotency
        if (!msg.includes('already exists') && !msg.includes('duplicate')) {
          results.push(`ERROR: ${stmt.substring(0, 30)}… → ${msg}`);
        } else {
          results.push(`SKIP: ${stmt.substring(0, 40)}… (already exists)`);
        }
      }
    }

    // 2. Seed agents (skip if already exist for this role+name combination)
    let agentsSeeded = 0;
    const agentResults: string[] = [];
    for (const agent of SEED_AGENTS) {
      try {
        const existing = await query(
          `SELECT id FROM agents WHERE name = $1 AND role = $2 LIMIT 1`,
          [agent.name, agent.role]
        );
        if (existing.length === 0) {
          await query(
            `INSERT INTO agents (name, role, personality_config, behavior_overrides, performance_score, article_slots)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              agent.name,
              agent.role,
              JSON.stringify(agent.personality_config),
              JSON.stringify(agent.behavior_overrides),
              agent.performance_score,
              agent.article_slots,
            ]
          );
          agentsSeeded++;
          agentResults.push(`CREATED: ${agent.name} (${agent.role})`);
        } else {
          agentResults.push(`EXISTS: ${agent.name} (${agent.role})`);
        }
      } catch (agentErr) {
        const msg = agentErr instanceof Error ? agentErr.message : String(agentErr);
        agentResults.push(`ERROR: ${agent.name} (${agent.role}) → ${msg}`);
      }
    }

    // 3. Seed affiliate links (skip if already exist for platform+country)
    let affiliatesSeeded = 0;
    for (const link of SEED_AFFILIATE_LINKS) {
      const existing = await query(
        `SELECT id FROM affiliate_links WHERE platform_name = $1 AND country = $2 LIMIT 1`,
        [link.platform_name, link.country]
      );
      if (existing.length === 0) {
        await query(
          `INSERT INTO affiliate_links (platform_name, affiliate_url, country, priority_score, avg_conversion_rate)
           VALUES ($1, $2, $3, $4, $5)`,
          [link.platform_name, link.affiliate_url, link.country, link.priority_score, link.avg_conversion_rate]
        );
        affiliatesSeeded++;
      }
    }

    // 4. Astro DB (Turso) schema migrations — add columns that may be missing on the remote DB.
    // The db/config.ts schema is the source of truth, but ALTER TABLE must be run manually
    // when columns are added (astro db push --remote requires Astro Studio credentials).
    const astroDbResults: string[] = [];
    const astroDbMigrationSteps: Array<{ stmt: ReturnType<typeof drizzleSql>; label: string }> = [
      { stmt: drizzleSql`ALTER TABLE Post ADD COLUMN author TEXT DEFAULT 'Redactie'`, label: 'Post.author' },
      { stmt: drizzleSql`ALTER TABLE Post ADD COLUMN readingTime INTEGER DEFAULT 6`, label: 'Post.readingTime' },
    ];
    for (const m of astroDbMigrationSteps) {
      try {
        await db.run(m.stmt);
        astroDbResults.push(`ADDED: ${m.label}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column') || msg.includes('already exists')) {
          astroDbResults.push(`EXISTS: ${m.label}`);
        } else {
          astroDbResults.push(`ERROR: ${m.label} → ${msg}`);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Migration complete',
      tables_created: results,
      agents_seeded: agentsSeeded,
      agent_details: agentResults,
      affiliates_seeded: affiliatesSeeded,
      astro_db_migrations: astroDbResults,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[migrate] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
