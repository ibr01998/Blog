/**
 * Editorial Cycle Orchestrator
 *
 * runEditorialCycle() — the main function that wires all 6 agents together.
 *
 * Stages:
 *   1. Check system_config (paused? quota reached?)
 *   2. Analyst → AnalystReport
 *   3. Strategist(report) → 10 ArticleBriefs
 *   4. Editor(briefs) → ArticleAssignments (max 3)
 *   5. For each assignment:
 *      a. Writer → ArticleDraft
 *      b. Humanizer → ArticleHumanized
 *      c. SEO → ArticleOptimized
 *      d. Generate embedding vector
 *      e. Check slug uniqueness in Postgres (Astro DB check happens in API route)
 *      f. INSERT to articles table
 *      g. Backfill agent_logs.article_id for this cycle's logs
 *   6. (Optional) Apply evolution suggestions if enable_auto_evolution = true
 *   7. Return CycleSummary
 *
 * IMPORTANT: This file does NOT import 'astro:db'.
 * The Post table dual-write (on publish) lives in /api/admin/articles/[id].ts.
 */

import { query } from './db/postgres.ts';
import { generateEmbedding } from './embeddings.ts';
import { BaseAgent } from './agents/base.ts';
import { AnalystAgent } from './agents/analyst.ts';
import { StrategistAgent } from './agents/strategist.ts';
import { EditorAgent } from './agents/editor.ts';
import { WriterAgent } from './agents/writer.ts';
import { HumanizerAgent } from './agents/humanizer.ts';
import { SEOAgent } from './agents/seo.ts';
import type {
  AgentRole,
  AgentRecord,
  CycleSummary,
  ArticleOptimized,
} from './agents/types.ts';

// ─── Progress Callback ───────────────────────────────────────────────────────

export type ProgressEvent = {
  stage: string;
  progress: number;   // 0-100
  message: string;
};

export type ProgressCallback = (event: ProgressEvent) => void;

// ─── Generic Agent Factory ────────────────────────────────────────────────────

async function loadAgent<T extends BaseAgent>(
  role: AgentRole,
  AgentClass: new (record: AgentRecord) => T
): Promise<T> {
  const record = await BaseAgent.loadByRole(role);
  return new AgentClass(record);
}

// ─── Slug Uniqueness ──────────────────────────────────────────────────────────

/**
 * Ensure the slug is unique across ALL content sources:
 * 1. Postgres articles table (AI-generated)
 * 2. Content Collections (file-based)
 * 3. Astro DB Post table (checked via onConflictDoUpdate during publish)
 * If slug exists, appends -2, -3, etc.
 */
async function ensureUniqueSlug(slug: string): Promise<string> {
  // Import here to avoid loading collections on every orchestrator import
  const { getCollection } = await import('astro:content');
  const collections = await getCollection('blog');

  let candidate = slug;
  let suffix = 2;

  while (true) {
    // Check Postgres articles table
    const pgExists = await query(
      `SELECT id FROM articles WHERE slug = $1 LIMIT 1`,
      [candidate]
    );

    // Check Content Collections
    const collectionExists = collections.some(p => p.slug === candidate);

    // If unique in both sources, we're good
    if (pgExists.length === 0 && !collectionExists) {
      return candidate;
    }

    // Try next suffix
    candidate = `${slug}-${suffix}`;
    suffix++;

    if (suffix > 20) {
      throw new Error(`Could not generate unique slug for: ${slug}`);
    }
  }
}

// ─── Main Orchestration ───────────────────────────────────────────────────────

export async function runEditorialCycle(onProgress?: ProgressCallback): Promise<CycleSummary> {
  const emit = onProgress ?? (() => {});
  const cycleId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  // ── Step 1: Guard checks ──────────────────────────────────────────────────

  emit({ stage: 'init', progress: 0, message: 'Configuratie controleren...' });

  const configRows = await query<{
    system_paused: boolean;
    max_articles_per_week: number;
    auto_publish_enabled: boolean;
    enable_auto_evolution: boolean;
  }>('SELECT * FROM system_config WHERE id = 1 LIMIT 1');

  const cfg = configRows[0];

  if (!cfg) {
    throw new Error('system_config row (id=1) not found. Run /api/admin/migrate first.');
  }

  if (cfg.system_paused) {
    throw new Error('System is paused via system_config.system_paused = true. Resume in /dashboard/system.');
  }

  // Count articles produced since the start of the current week
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));
  weekStart.setHours(0, 0, 0, 0);

  const weeklyRows = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM articles WHERE created_at >= $1`,
    [weekStart.toISOString()]
  );
  const currentWeeklyCount = parseInt(weeklyRows[0]?.count ?? '0');

  if (currentWeeklyCount >= cfg.max_articles_per_week) {
    throw new Error(
      `Weekly article quota reached (${currentWeeklyCount}/${cfg.max_articles_per_week}). ` +
      `Resets on Monday. Adjust max_articles_per_week in /dashboard/system if needed.`
    );
  }

  // ── Step 1b: Sync Astro DB analytics → Postgres article_metrics ─────────

  emit({ stage: 'sync', progress: 3, message: 'Metrics synchroniseren (Astro DB → Postgres)...' });

  try {
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : ((import.meta as any).env?.SITE ?? 'http://localhost:4321');
    const cronSecret = (import.meta as any).env?.CRON_SECRET ?? process.env.CRON_SECRET ?? '';

    await fetch(`${origin}/api/analytics/sync-metrics`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'x-internal-sync': 'true',
        'Content-Type': 'application/json',
      },
    });
  } catch (syncErr) {
    // Non-fatal: analyst will work with stale data if sync fails
    console.warn('[Orchestrator] Metrics sync failed (non-fatal):', syncErr);
  }

  // ── Step 2: Analyst ───────────────────────────────────────────────────────

  emit({ stage: 'analyst', progress: 5, message: 'Markt-Analist analyseert marktdata en prestaties...' });

  const analystAgent = await loadAgent('analyst', AnalystAgent);
  const analystReport = await analystAgent.run();

  // ── Step 3: Strategist ────────────────────────────────────────────────────

  emit({ stage: 'strategist', progress: 20, message: 'Strateeg genereert artikel briefings...' });

  const strategistAgent = await loadAgent('strategist', StrategistAgent);
  const briefs = await strategistAgent.run(analystReport);

  // ── Step 4: Editor ────────────────────────────────────────────────────────

  emit({ stage: 'editor', progress: 35, message: `Redacteur selecteert uit ${briefs.length} briefings...` });

  const editorAgent = await loadAgent('editor', EditorAgent);
  const assignments = await editorAgent.run(briefs);

  if (assignments.length === 0) {
    return {
      cycle_id: cycleId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      analyst_report: analystReport,
      briefs_generated: briefs.length,
      assignments_made: 0,
      articles_produced: 0,
      articles_skipped_cooldown: briefs.length,
      articles_skipped_similarity: 0,
      article_ids: [],
    };
  }

  // ── Step 5: Per-assignment pipeline ──────────────────────────────────────

  const writerAgent = await loadAgent('writer', WriterAgent);
  const humanizerAgent = await loadAgent('humanizer', HumanizerAgent);
  const seoAgent = await loadAgent('seo', SEOAgent);

  // Apply analyst evolution suggestions to in-memory agents immediately,
  // so this cycle's articles already benefit from the recommended overrides.
  if (cfg.enable_auto_evolution && analystReport.suggested_agent_overrides.length > 0) {
    const agentMap = new Map<string, BaseAgent>([
      [writerAgent.id, writerAgent],
      [humanizerAgent.id, humanizerAgent],
      [seoAgent.id, seoAgent],
    ]);
    for (const suggestion of analystReport.suggested_agent_overrides) {
      const agent = agentMap.get(suggestion.agent_id);
      // Strip null values — only apply overrides that are explicitly set
      const cleanOverrides = Object.fromEntries(
        Object.entries(suggestion.suggested_overrides).filter(([, v]) => v !== null)
      );
      if (agent && Object.keys(cleanOverrides).length > 0) {
        agent.applyOverrides(cleanOverrides);
      }
    }
  }

  const articleIds: string[] = [];
  const errors: string[] = [];

  const totalAssignments = assignments.length;
  const ARTICLE_START = 45;
  const ARTICLE_END = 95;
  const perArticleRange = totalAssignments > 0 ? (ARTICLE_END - ARTICLE_START) / totalAssignments : 0;

  for (let i = 0; i < assignments.length; i++) {
    const assignment = assignments[i];
    const articleBase = ARTICLE_START + i * perArticleRange;
    const keyword = assignment.brief.primary_keyword;

    try {
      // 5a. Write
      emit({ stage: 'writer', progress: Math.round(articleBase), message: `Schrijver schrijft artikel ${i + 1}/${totalAssignments}: "${keyword}"` });
      const draft = await writerAgent.run(assignment);

      // 5b. Humanize
      emit({ stage: 'humanizer', progress: Math.round(articleBase + perArticleRange * 0.4), message: `Humanizer verfijnt artikel: "${draft.title}"` });
      const humanized = await humanizerAgent.run(draft);

      // 5c. SEO optimize
      emit({ stage: 'seo', progress: Math.round(articleBase + perArticleRange * 0.7), message: `SEO optimaliseert artikel: "${humanized.title}"` });
      const optimized = await seoAgent.run(humanized);

      // 5d. Generate embedding
      emit({ stage: 'embedding', progress: Math.round(articleBase + perArticleRange * 0.9), message: `Embedding genereren en opslaan: "${optimized.title}"` });
      const embeddingInput = [
        optimized.primary_keyword,
        optimized.title,
        optimized.article_markdown.substring(0, 2000),
      ].join(' ');
      const embedding = await generateEmbedding(embeddingInput);

      // 5e. Pre-generate article UUID and ensure unique slug
      const articleId = crypto.randomUUID();
      const uniqueSlug = await ensureUniqueSlug(optimized.slug);

      // 5f. INSERT to articles table
      // NOTE: embedding must be cast as ::vector — pass JSON.stringify(array)
      await query(
        `INSERT INTO articles (
          id, title, slug, language, writer_id,
          content_tier, primary_keyword, intent, hook_type, format_type,
          word_count, article_markdown, meta_description, meta_title,
          embedding, status, review_status
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15::vector, $16, $17
        )`,
        [
          articleId,
          optimized.title,
          uniqueSlug,
          'nl',
          assignment.writer_id,
          assignment.brief.content_tier,
          optimized.primary_keyword,
          assignment.brief.intent,
          assignment.brief.hook_type,
          assignment.brief.format_type,
          optimized.word_count,
          optimized.article_markdown,
          optimized.meta_description,
          optimized.meta_title,
          JSON.stringify(embedding),   // pgvector accepts JSON array string cast to ::vector
          'draft',
          'pending',
        ]
      );

      articleIds.push(articleId);

      // 5g. Backfill article_id in agent_logs for this cycle's entries
      // Updates recent NULL article_id entries for the writer agent (within last 15 minutes)
      await query(
        `UPDATE agent_logs
         SET article_id = $1
         WHERE article_id IS NULL
           AND agent_id = $2
           AND created_at > NOW() - INTERVAL '15 minutes'`,
        [articleId, assignment.writer_id]
      );

      // Also backfill for humanizer and SEO agents
      const helperAgents = [humanizerAgent.id, seoAgent.id];
      for (const agentId of helperAgents) {
        await query(
          `UPDATE agent_logs
           SET article_id = $1
           WHERE article_id IS NULL
             AND agent_id = $2
             AND created_at > NOW() - INTERVAL '15 minutes'`,
          [articleId, agentId]
        );
      }

      // Create initial article_metrics row for tracking
      await query(
        `INSERT INTO article_metrics (article_id) VALUES ($1)`,
        [articleId]
      );

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Assignment ${assignment.assignment_id}: ${errorMsg}`);
      emit({ stage: 'error', progress: Math.round(articleBase + perArticleRange), message: `Fout bij artikel "${keyword}": ${errorMsg}` });
      console.error('[Orchestrator] Pipeline failed for assignment:', assignment.brief.primary_keyword, err);
    }
  }

  // ── Step 6: Auto-evolution (if enabled) ──────────────────────────────────

  if (cfg.enable_auto_evolution && analystReport.suggested_agent_overrides.length > 0) {
    for (const suggestion of analystReport.suggested_agent_overrides) {
      try {
        // Strip null values — only persist overrides that are explicitly set
        const cleanOverrides = Object.fromEntries(
          Object.entries(suggestion.suggested_overrides).filter(([, v]) => v !== null)
        );
        if (suggestion.agent_id && Object.keys(cleanOverrides).length > 0) {
          await query(
            `UPDATE agents
             SET behavior_overrides = behavior_overrides || $1::jsonb
             WHERE id = $2`,
            [JSON.stringify(cleanOverrides), suggestion.agent_id]
          );
        }
        // Mark log as applied so it no longer appears in the dashboard queue
        await query(
          `UPDATE agent_logs
           SET stage = 'evolution:applied'
           WHERE stage = 'evolution:suggestion'
             AND input_summary->>'agent_id' = $1`,
          [suggestion.agent_id]
        );
      } catch (err) {
        console.warn('[Orchestrator] Auto-evolution update failed for agent:', suggestion.agent_id, err);
      }
    }
  }

  // ── Step 7: Return summary ────────────────────────────────────────────────

  emit({ stage: 'done', progress: 100, message: `Cyclus voltooid: ${articleIds.length} artikel(en) geproduceerd.` });

  const summary: CycleSummary = {
    cycle_id: cycleId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    analyst_report: analystReport,
    briefs_generated: briefs.length,
    assignments_made: assignments.length,
    articles_produced: articleIds.length,
    articles_skipped_cooldown: briefs.length - assignments.length,
    articles_skipped_similarity: 0, // tracked internally by EditorAgent
    article_ids: articleIds,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };

  return summary;
}
