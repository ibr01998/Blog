/**
 * Editorial Cycle Orchestrator — Autonomous AI Editorial Engine
 *
 * runEditorialCycle() — the main function that wires all agents together.
 *
 * Pipeline Stages:
 *   1. Check system_config (paused? quota reached? adaptive timestamp?)
 *   1b. Sync analytics (Astro DB → Postgres)
 *   2. Analyst → AnalystReport
 *   3a. Strategist Governor → StrategistGovernorOutput (scheduling decisions)
 *   3b. Strategist Briefs → ArticleBriefs[]
 *   4. Editor → ArticleAssignments (max articles_this_cycle)
 *   5. For each assignment:
 *      a. Writer → ArticleDraft
 *      b. Humanizer → ArticleHumanized
 *      c. FactChecker → ArticleFactChecked (with retry loop, max 3 attempts)
 *      d. SEO → ArticleOptimized
 *      e. Image Generation → hero + body images
 *      f. Visual Inspector → InspectionResult (with revision loop, max 3 attempts)
 *      g. Generate embedding vector
 *      h. Check slug uniqueness
 *      i. INSERT to articles table
 *      j. Backfill agent_logs
 *      k. Auto-publish (if enabled)
 *   6. Apply evolution suggestions (if enable_auto_evolution)
 *   7. Return CycleSummary
 */

import { query } from './db/postgres.ts';
import { generateEmbedding } from './embeddings.ts';
import { generateAllImages } from './images.ts';
import { BaseAgent } from './agents/base.ts';
import { AnalystAgent } from './agents/analyst.ts';
import { StrategistAgent } from './agents/strategist.ts';
import { EditorAgent } from './agents/editor.ts';
import { WriterAgent } from './agents/writer.ts';
import { HumanizerAgent } from './agents/humanizer.ts';
import { SEOAgent } from './agents/seo.ts';
import { FactCheckerAgent } from './agents/fact-checker.ts';
import { VisualInspectorAgent } from './agents/visual-inspector.ts';
import {
  publishToPostTable,
  recordPublishEvent,
  pingGoogleIndexing,
} from './publish-utils.ts';
import type {
  AgentRole,
  AgentRecord,
  CycleSummary,
  ArticleHumanized,
  ArticleFactChecked,
  ArticleOptimized,
  ArticleWithImages,
  BodyImage,
  StrategistGovernorOutput,
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

/**
 * Try to load an agent, auto-creating it if it doesn't exist.
 * Returns null only on total failure.
 */
async function tryLoadAgent<T extends BaseAgent>(
  role: AgentRole,
  AgentClass: new (record: AgentRecord) => T,
  seedConfig: { name: string; personality_config: string; behavior_overrides: string }
): Promise<T | null> {
  try {
    return await loadAgent(role, AgentClass);
  } catch {
    try {
      await query(
        `INSERT INTO agents (name, role, personality_config, behavior_overrides, performance_score, article_slots)
         SELECT $1, $2, $3::jsonb, $4::jsonb, 0.5, 0
         WHERE NOT EXISTS (SELECT 1 FROM agents WHERE role = $2)`,
        [seedConfig.name, role, seedConfig.personality_config, seedConfig.behavior_overrides]
      );
      return await loadAgent(role, AgentClass);
    } catch (seedErr) {
      console.warn(`[Orchestrator] Could not create/load ${role} agent — skipping:`, seedErr);
      return null;
    }
  }
}

// ─── Slug Uniqueness ──────────────────────────────────────────────────────────

/**
 * Ensure the slug is unique across ALL content sources:
 * 1. Postgres articles table (AI-generated)
 * 2. Content Collections (file-based)
 * 3. Astro DB Post table (checked via onConflictDoUpdate during publish)
 */
async function ensureUniqueSlug(slug: string): Promise<string> {
  const { getCollection } = await import('astro:content');
  const collections = await getCollection('blog');

  let candidate = slug;
  let suffix = 2;

  while (true) {
    const pgExists = await query(
      `SELECT id FROM articles WHERE slug = $1 LIMIT 1`,
      [candidate]
    );
    const collectionExists = collections.some(p => p.slug === candidate);

    if (pgExists.length === 0 && !collectionExists) {
      return candidate;
    }

    candidate = `${slug}-${suffix}`;
    suffix++;

    if (suffix > 20) {
      throw new Error(`Could not generate unique slug for: ${slug}`);
    }
  }
}

// ─── Main Orchestration ───────────────────────────────────────────────────────

export async function runEditorialCycle(
  onProgress?: ProgressCallback,
  options?: { skipTimestampGuard?: boolean }
): Promise<CycleSummary> {
  const emit = onProgress ?? (() => { });
  const cycleId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  // ── Step 1: Guard checks ──────────────────────────────────────────────────

  emit({ stage: 'init', progress: 0, message: 'Configuratie controleren...' });

  const configRows = await query<{
    system_paused: boolean;
    max_articles_per_week: number;
    auto_publish_enabled: boolean;
    enable_auto_evolution: boolean;
    next_run_timestamp: string | null;
    articles_this_cycle: number;
  }>('SELECT * FROM system_config WHERE id = 1 LIMIT 1');

  const cfg = configRows[0];

  if (!cfg) {
    throw new Error('system_config row (id=1) not found. Run /api/admin/migrate first.');
  }

  if (cfg.system_paused) {
    throw new Error('System is paused via system_config.system_paused = true. Resume in /dashboard/system.');
  }

  // Adaptive scheduling guard: skip if it's too early (unless manually triggered)
  if (!options?.skipTimestampGuard && cfg.next_run_timestamp) {
    const nextRun = new Date(cfg.next_run_timestamp);
    if (nextRun > new Date()) {
      throw new Error(
        `Adaptive scheduling: next run scheduled for ${nextRun.toISOString()}. ` +
        `Use manual trigger to override.`
      );
    }
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
    console.warn('[Orchestrator] Metrics sync failed (non-fatal):', syncErr);
  }

  // ── Step 2: Analyst ───────────────────────────────────────────────────────

  emit({ stage: 'analyst', progress: 5, message: 'Markt-Analist analyseert marktdata en prestaties...' });

  const analystAgent = await loadAgent('analyst', AnalystAgent);
  const analystReport = await analystAgent.run();

  // ── Step 3a: Strategist Governor (adaptive scheduling) ─────────────────

  emit({ stage: 'governor', progress: 12, message: 'Strategist Governor bepaalt publicatieschema...' });

  const strategistAgent = await loadAgent('strategist', StrategistAgent);
  let governorOutput: StrategistGovernorOutput | null = null;

  try {
    governorOutput = await strategistAgent.runGovernor(analystReport);
    emit({
      stage: 'governor',
      progress: 15,
      message: `Schema: ${governorOutput.articles_this_cycle} artikelen, volgende cyclus: ${governorOutput.next_run_timestamp}`,
    });
  } catch (govErr) {
    console.warn('[Orchestrator] Governor phase failed (non-fatal), using defaults:', govErr);
  }

  // Use governor's article count if available, otherwise use system_config default
  const maxArticlesThisCycle = governorOutput?.articles_this_cycle ?? cfg.articles_this_cycle;

  // ── Step 3b: Strategist Briefs ─────────────────────────────────────────

  emit({ stage: 'strategist', progress: 18, message: 'Strateeg genereert artikel briefings...' });

  const briefs = await strategistAgent.run(analystReport);

  // ── Step 4: Editor ────────────────────────────────────────────────────────

  emit({ stage: 'editor', progress: 30, message: `Redacteur selecteert uit ${briefs.length} briefings (max ${maxArticlesThisCycle})...` });

  const editorAgent = await loadAgent('editor', EditorAgent);
  let assignments = await editorAgent.run(briefs);

  // Cap assignments at the governor's recommended count
  if (assignments.length > maxArticlesThisCycle) {
    assignments = assignments.slice(0, maxArticlesThisCycle);
  }

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

  // Fact checker — auto-create if missing
  const factCheckerAgent = await tryLoadAgent('fact_checker', FactCheckerAgent, {
    name: 'Feiten-Checker',
    personality_config: '{"tone":"critical","writing_style":"precise","preferred_formats":[]}',
    behavior_overrides: '{}',
  });

  // Visual inspector — auto-create if missing
  const visualInspectorAgent = await tryLoadAgent('visual_inspector', VisualInspectorAgent, {
    name: 'Visuele Inspecteur',
    personality_config: '{"tone":"meticulous","writing_style":"structured","preferred_formats":[]}',
    behavior_overrides: '{}',
  });

  // Apply analyst evolution suggestions to in-memory agents
  if (cfg.enable_auto_evolution && analystReport.suggested_agent_overrides.length > 0) {
    const agentMap = new Map<string, BaseAgent>([
      [writerAgent.id, writerAgent],
      [humanizerAgent.id, humanizerAgent],
      [seoAgent.id, seoAgent],
    ]);
    for (const suggestion of analystReport.suggested_agent_overrides) {
      const agent = agentMap.get(suggestion.agent_id);
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
  const ARTICLE_START = 35;
  const ARTICLE_END = 95;
  const perArticleRange = totalAssignments > 0 ? (ARTICLE_END - ARTICLE_START) / totalAssignments : 0;

  // Resolve the origin URL for image generation
  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : ((import.meta as any).env?.SITE ?? 'http://localhost:4321');
  const siteUrl = (import.meta as any).env?.SITE ?? origin;

  for (let i = 0; i < assignments.length; i++) {
    const assignment = assignments[i];
    const articleBase = ARTICLE_START + i * perArticleRange;
    const keyword = assignment.brief.primary_keyword;

    try {
      // ─── 5a. Write ──────────────────────────────────────────────────────
      emit({ stage: 'writer', progress: Math.round(articleBase), message: `Schrijver schrijft artikel ${i + 1}/${totalAssignments}: "${keyword}"` });
      const draft = await writerAgent.run(assignment);

      // ─── 5b. Humanize ───────────────────────────────────────────────────
      emit({ stage: 'humanizer', progress: Math.round(articleBase + perArticleRange * 0.15), message: `Humanizer verfijnt: "${draft.title}"` });
      const humanized = await humanizerAgent.run(draft);

      // ─── 5c. FactChecker with retry loop (max 3 attempts) ──────────────
      let factChecked: ArticleFactChecked;
      let factCorrectionCount = 0;

      if (factCheckerAgent) {
        emit({ stage: 'fact_checker', progress: Math.round(articleBase + perArticleRange * 0.25), message: `Feiten controleren: "${humanized.title}"` });

        let currentMarkdown = humanized.article_markdown;
        let currentArticle: ArticleHumanized = humanized;

        for (let attempt = 0; attempt < 3; attempt++) {
          factChecked = await factCheckerAgent.run(currentArticle);

          if (factChecked.fact_check_status === 'passed') break;

          // Only retry if there are actionable issues
          const actionableIssues = factChecked.fact_check_issues.filter(
            issue => issue.severity === 'error' || issue.severity === 'warning'
          );

          if (actionableIssues.length === 0 || attempt === 2) break;

          // Send flagged fragments to writer for rewrite
          emit({
            stage: 'fact_checker',
            progress: Math.round(articleBase + perArticleRange * (0.25 + 0.05 * (attempt + 1))),
            message: `Correctie poging ${attempt + 1}: ${actionableIssues.length} problemen gevonden`,
          });

          const rewriteResult = await writerAgent.rewriteFragments(
            actionableIssues,
            currentMarkdown,
          );

          currentMarkdown = rewriteResult.updatedMarkdown;
          currentArticle = { ...currentArticle, article_markdown: currentMarkdown };
          factCorrectionCount++;
        }

        // Ensure factChecked is defined even if loop didn't execute
        factChecked = factChecked!;
      } else {
        factChecked = { ...humanized, fact_check_status: 'passed' as const, fact_check_issues: [] };
      }

      // ─── 5d. SEO optimize ───────────────────────────────────────────────
      emit({ stage: 'seo', progress: Math.round(articleBase + perArticleRange * 0.40), message: `SEO optimaliseert: "${factChecked.title}"` });
      const optimized = await seoAgent.run(factChecked);

      // ─── 5e. Pre-generate slug for image paths ─────────────────────────
      const uniqueSlug = await ensureUniqueSlug(optimized.slug);

      // ─── 5f. Image Generation ───────────────────────────────────────────
      emit({ stage: 'images', progress: Math.round(articleBase + perArticleRange * 0.50), message: `Afbeeldingen genereren: "${optimized.title}"` });

      let heroImageUrl: string | null = null;
      let bodyImages: BodyImage[] = [];
      let articleMarkdownWithImages = optimized.article_markdown;

      try {
        const imageResult = await generateAllImages({
          markdown: optimized.article_markdown,
          title: optimized.title,
          keyword: optimized.primary_keyword,
          slug: uniqueSlug,
          origin,
        });

        heroImageUrl = imageResult.heroImage;
        bodyImages = imageResult.bodyImages;
        articleMarkdownWithImages = imageResult.updatedMarkdown;

        if (imageResult.errors.length > 0) {
          console.warn(`[Orchestrator] Image generation partial errors for "${uniqueSlug}":`, imageResult.errors);
        }
      } catch (imgErr) {
        console.warn('[Orchestrator] Image generation failed (non-fatal):', imgErr);
      }

      // ─── 5g. Visual Inspector loop (max 3 attempts) ────────────────────
      let inspectionRevisionCount = 0;

      if (visualInspectorAgent) {
        emit({ stage: 'visual_inspector', progress: Math.round(articleBase + perArticleRange * 0.62), message: `Visuele inspectie: "${optimized.title}"` });

        // Build the article-with-images object
        let articleWithImages: ArticleWithImages = {
          ...optimized,
          article_markdown: articleMarkdownWithImages,
          hero_image_url: heroImageUrl,
          body_images_data: bodyImages,
        };

        for (let attempt = 0; attempt < 3; attempt++) {
          const inspection = await visualInspectorAgent.run(articleWithImages);

          if (inspection.status === 'APPROVED') break;

          if (attempt === 2) {
            // Max retries reached — leave as pending for human review
            console.warn(`[Orchestrator] Visual inspection failed after 3 attempts for "${uniqueSlug}"`);
            break;
          }

          emit({
            stage: 'visual_inspector',
            progress: Math.round(articleBase + perArticleRange * (0.62 + 0.04 * (attempt + 1))),
            message: `Revisie ${attempt + 1}: ${inspection.actions.length} acties`,
          });

          // Route each action to the appropriate agent
          for (const action of inspection.actions) {
            try {
              if (action.target === 'writer') {
                // Writer revision: rewrite the problematic section
                const fixResult = await writerAgent.rewriteFragments(
                  [{
                    claim: action.issue,
                    section: action.section || '',
                    severity: 'warning',
                    issue: action.issue,
                    suggestion: 'Fix as described',
                    source: 'unverifiable',
                    action: 'rewrite',
                  }],
                  articleWithImages.article_markdown,
                );
                articleWithImages = {
                  ...articleWithImages,
                  article_markdown: fixResult.updatedMarkdown,
                };
              } else if (action.target === 'image_generator') {
                // Re-generate images
                try {
                  const regenResult = await generateAllImages({
                    markdown: articleWithImages.article_markdown,
                    title: articleWithImages.title,
                    keyword: articleWithImages.primary_keyword,
                    slug: uniqueSlug,
                    origin,
                    existingHeroImage: articleWithImages.hero_image_url,
                    forceRegenerateHero: action.issue.toLowerCase().includes('hero'),
                  });
                  articleWithImages = {
                    ...articleWithImages,
                    article_markdown: regenResult.updatedMarkdown,
                    hero_image_url: regenResult.heroImage ?? articleWithImages.hero_image_url,
                    body_images_data: regenResult.bodyImages.length > 0
                      ? regenResult.bodyImages
                      : articleWithImages.body_images_data,
                  };
                } catch {
                  // Image regen failed — continue with existing
                }
              } else if (action.target === 'seo') {
                // SEO revision: re-run SEO agent on the current article
                const seoFixed = await seoAgent.run({
                  ...factChecked,
                  article_markdown: articleWithImages.article_markdown,
                });
                articleWithImages = {
                  ...articleWithImages,
                  article_markdown: seoFixed.article_markdown,
                  meta_title: seoFixed.meta_title,
                  meta_description: seoFixed.meta_description,
                  keyword_density: seoFixed.keyword_density,
                  faq_schema_added: seoFixed.faq_schema_added,
                  faq_items: seoFixed.faq_items,
                };
              }
            } catch (fixErr) {
              console.warn(`[Orchestrator] Inspection fix failed (${action.target}):`, fixErr);
            }
          }

          inspectionRevisionCount++;

          // Update final variables from the revised article
          articleMarkdownWithImages = articleWithImages.article_markdown;
          heroImageUrl = articleWithImages.hero_image_url;
          bodyImages = articleWithImages.body_images_data;
        }
      }

      // ─── 5h. Generate embedding ────────────────────────────────────────
      emit({ stage: 'embedding', progress: Math.round(articleBase + perArticleRange * 0.78), message: `Embedding genereren: "${optimized.title}"` });
      const embeddingInput = [
        optimized.primary_keyword,
        optimized.title,
        articleMarkdownWithImages.substring(0, 2000),
      ].join(' ');
      const embedding = await generateEmbedding(embeddingInput);

      // ─── 5i. INSERT to articles table ──────────────────────────────────
      const articleId = crypto.randomUUID();
      const readingTime = Math.ceil((optimized.word_count || 1000) / 200);
      const reviewStatus = 'pending';

      emit({ stage: 'save', progress: Math.round(articleBase + perArticleRange * 0.85), message: `Opslaan: "${optimized.title}"` });

      await query(
        `INSERT INTO articles (
          id, title, slug, language, writer_id,
          content_tier, primary_keyword, intent, hook_type, format_type,
          word_count, article_markdown, meta_description, meta_title,
          embedding, status, review_status, image_url,
          author, reading_time, body_images,
          fact_check_status, fact_check_issues,
          fact_correction_count, inspection_revision_count
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15::vector, $16, $17, $18,
          $19, $20, $21::jsonb,
          $22, $23::jsonb,
          $24, $25
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
          articleMarkdownWithImages,
          optimized.meta_description,
          optimized.meta_title,
          JSON.stringify(embedding),
          'draft',
          reviewStatus,
          heroImageUrl,
          'Redactie',
          readingTime,
          JSON.stringify(bodyImages),
          factChecked.fact_check_status,
          JSON.stringify(factChecked.fact_check_issues),
          factCorrectionCount,
          inspectionRevisionCount,
        ]
      );

      articleIds.push(articleId);

      // ─── 5j. Backfill agent_logs ───────────────────────────────────────
      const allAgentIds = [
        assignment.writer_id,
        humanizerAgent.id,
        ...(factCheckerAgent ? [factCheckerAgent.id] : []),
        seoAgent.id,
        ...(visualInspectorAgent ? [visualInspectorAgent.id] : []),
      ];
      for (const agentId of allAgentIds) {
        await query(
          `UPDATE agent_logs
           SET article_id = $1
           WHERE article_id IS NULL
             AND agent_id = $2
             AND created_at > NOW() - INTERVAL '15 minutes'`,
          [articleId, agentId]
        );
      }

      // Create initial article_metrics row
      await query(
        `INSERT INTO article_metrics (article_id) VALUES ($1)`,
        [articleId]
      );

      // ─── 5k. Auto-publish (if enabled) ─────────────────────────────────
      if (cfg.auto_publish_enabled) {
        emit({ stage: 'publish', progress: Math.round(articleBase + perArticleRange * 0.92), message: `Auto-publiceren: "${optimized.title}"` });

        try {
          // Fetch the full article for publishing
          const pubRows = await query<{
            id: string; title: string; slug: string; meta_description: string;
            meta_title: string; article_markdown: string; primary_keyword: string;
            format_type: string; image_url: string | null; author: string;
            reading_time: number;
          }>(
            `SELECT id, title, slug, meta_description, meta_title, article_markdown,
                    primary_keyword, format_type, image_url, author, reading_time
             FROM articles WHERE id = $1 LIMIT 1`,
            [articleId]
          );

          if (pubRows[0]) {
            await publishToPostTable(pubRows[0]);
            await recordPublishEvent(articleId);

            // Best-effort: ping Google Indexing API
            const articleUrl = `${siteUrl}/${uniqueSlug}`;
            pingGoogleIndexing(articleUrl).catch(() => {
              // Non-fatal — already logged inside the function
            });

            emit({ stage: 'publish', progress: Math.round(articleBase + perArticleRange * 0.95), message: `✅ Gepubliceerd: "${optimized.title}"` });
          }
        } catch (pubErr) {
          console.warn('[Orchestrator] Auto-publish failed (non-fatal):', pubErr);
          errors.push(`Auto-publish failed for "${optimized.title}": ${pubErr instanceof Error ? pubErr.message : String(pubErr)}`);
        }
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (errorMsg.includes('timed out')) {
        errors.push(`Assignment ${assignment.assignment_id}: AI generation timed out. Try again later.`);
        emit({
          stage: 'error',
          progress: Math.round(articleBase + perArticleRange),
          message: `⏱️ Timeout bij "${keyword}": ${errorMsg}`,
        });
      } else {
        errors.push(`Assignment ${assignment.assignment_id}: ${errorMsg}`);
        emit({
          stage: 'error',
          progress: Math.round(articleBase + perArticleRange),
          message: `Fout bij "${keyword}": ${errorMsg}`,
        });
      }

      console.error('[Orchestrator] Pipeline failed for assignment:', assignment.brief.primary_keyword, err);
    }
  }

  // ── Step 6: Auto-evolution (if enabled) ──────────────────────────────────

  if (cfg.enable_auto_evolution && analystReport.suggested_agent_overrides.length > 0) {
    for (const suggestion of analystReport.suggested_agent_overrides) {
      try {
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
        await query(
          `UPDATE agent_logs
           SET stage = 'evolution:applied'
           WHERE stage = 'evolution:suggestion'
             AND input_summary->>'agent_id' = $1`,
          [suggestion.agent_id]
        );
      } catch (err) {
        console.warn('[Orchestrator] Auto-evolution update failed:', suggestion.agent_id, err);
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
    articles_skipped_similarity: 0,
    article_ids: articleIds,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };

  return summary;
}
