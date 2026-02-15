/**
 * EditorAgent — filters and assigns article briefs from the Strategist.
 *
 * Responsibilities:
 *  - Enforce keyword cooldown (60 days — no repeated keywords)
 *  - Enforce semantic similarity threshold (<0.30 cosine distance rejects brief)
 *  - Enforce max articles per week (from system_config)
 *  - Assign writer agents via round-robin by performance_score
 *  - Log all decisions (accepted and rejected) to agent_logs
 */

import { BaseAgent } from './base.ts';
import { query } from '../db/postgres.ts';
import { generateEmbedding, cosineSimilarity } from '../embeddings.ts';
import type {
  AgentRecord,
  ArticleBrief,
  ArticleAssignment,
  AgentRole,
} from './types.ts';

const COOLDOWN_DAYS = 60;
const SIMILARITY_THRESHOLD = 0.30; // cosine DISTANCE threshold — below this means "too similar"
const DEFAULT_MAX_PER_WEEK = 3;
const MAX_PER_CYCLE = 3; // Hard cap: never produce more than 3 articles per cycle run

interface WriterAgentRow {
  id: string;
  name: string;
  role: string;
  performance_score: number;
}

interface ArticleEmbeddingRow {
  id: string;
  title: string;
  embedding: string; // pgvector returns as string "[0.1,0.2,...]"
}

export class EditorAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  async run(briefs: ArticleBrief[]): Promise<ArticleAssignment[]> {
    // 1. Get weekly quota from system_config
    const configRows = await query<{ max_articles_per_week: number }>(
      'SELECT max_articles_per_week FROM system_config WHERE id = 1'
    );
    const maxPerWeek = configRows[0]?.max_articles_per_week ?? DEFAULT_MAX_PER_WEEK;

    // 2. Count articles produced this week (Mon 00:00 to now)
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));
    weekStart.setHours(0, 0, 0, 0);

    const weeklyRows = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM articles WHERE created_at >= $1`,
      [weekStart.toISOString()]
    );
    const weekCount = parseInt(weeklyRows[0]?.count ?? '0');
    const slotsRemaining = Math.min(MAX_PER_CYCLE, Math.max(0, maxPerWeek - weekCount));

    if (slotsRemaining === 0) {
      await this.log({
        stage: 'editor:quota_reached',
        inputSummary: { brief_count: briefs.length },
        decisionSummary: { week_count: weekCount, max_per_week: maxPerWeek },
        reasoningSummary: `Weekly quota reached (${weekCount}/${maxPerWeek}). No assignments made.`,
      });
      return [];
    }

    // 3. Get active writer agents ordered by performance_score DESC
    const writers = await query<WriterAgentRow>(
      `SELECT id, name, role, performance_score FROM agents WHERE role = 'writer' AND is_active = true ORDER BY performance_score DESC`
    );
    if (writers.length === 0) {
      throw new Error('No active writer agents found. Seed agents first via /api/admin/migrate.');
    }

    // 4. Pre-fetch recent article embeddings for similarity checks (last 50)
    const existingEmbeddings = await query<ArticleEmbeddingRow>(
      `SELECT id, title, embedding::text as embedding FROM articles WHERE embedding IS NOT NULL ORDER BY created_at DESC LIMIT 50`
    );

    const assignments: ArticleAssignment[] = [];
    let writerIndex = 0;
    let rejectedCooldown = 0;
    let rejectedSimilarity = 0;

    for (const brief of briefs) {
      if (assignments.length >= slotsRemaining) break;

      // 5. Keyword cooldown check (case-insensitive)
      const cooldownRows = await query(
        `SELECT id FROM articles WHERE LOWER(primary_keyword) = LOWER($1) AND created_at > NOW() - INTERVAL '${COOLDOWN_DAYS} days' LIMIT 1`,
        [brief.primary_keyword]
      );
      if (cooldownRows.length > 0) {
        rejectedCooldown++;
        await this.log({
          stage: 'editor:rejected_cooldown',
          inputSummary: { keyword: brief.primary_keyword },
          decisionSummary: { reason: 'keyword_in_cooldown', cooldown_days: COOLDOWN_DAYS },
          reasoningSummary: `Keyword "${brief.primary_keyword}" was used within the last ${COOLDOWN_DAYS} days. Brief rejected.`,
        });
        continue;
      }

      // 6. Semantic similarity check against existing articles
      let tooSimilar = false;
      let maxSimilarity = 0;

      if (existingEmbeddings.length > 0) {
        try {
          const briefEmbedding = await generateEmbedding(
            `${brief.primary_keyword} ${brief.title_suggestion}`
          );

          for (const row of existingEmbeddings) {
            if (!row.embedding) continue;
            // pgvector returns embeddings as "[0.1,0.2,...]" string — parse it
            const existingVector = JSON.parse(row.embedding) as number[];
            const similarity = cosineSimilarity(briefEmbedding, existingVector);
            if (similarity > maxSimilarity) maxSimilarity = similarity;
            // cosine DISTANCE = 1 - similarity; reject if distance < threshold (too similar)
            if (1 - similarity < SIMILARITY_THRESHOLD) {
              tooSimilar = true;
              break;
            }
          }
        } catch (err) {
          // If embedding fails, don't block — just log and continue
          console.warn('[EditorAgent] Embedding generation failed for similarity check:', err);
        }
      }

      if (tooSimilar) {
        rejectedSimilarity++;
        await this.log({
          stage: 'editor:rejected_similarity',
          inputSummary: { keyword: brief.primary_keyword, max_similarity: maxSimilarity },
          decisionSummary: {
            reason: 'too_similar_to_existing',
            cosine_distance: 1 - maxSimilarity,
            threshold: SIMILARITY_THRESHOLD,
          },
          reasoningSummary: `Brief "${brief.title_suggestion}" is too similar to existing content (distance: ${(1 - maxSimilarity).toFixed(3)}, threshold: ${SIMILARITY_THRESHOLD}). Rejected.`,
        });
        continue;
      }

      // 7. Assign writer (round-robin from sorted-by-performance list)
      const writer = writers[writerIndex % writers.length];
      writerIndex++;

      const assignment: ArticleAssignment = {
        assignment_id: crypto.randomUUID(),
        brief,
        writer_id: writer.id,
        writer_role: writer.role as AgentRole,
        writer_name: writer.name,
        assigned_at: new Date().toISOString(),
        cooldown_passed: true,
        similarity_score: 1 - maxSimilarity, // cosine distance
        editor_reasoning: `Keyword clear of ${COOLDOWN_DAYS}-day cooldown. Similarity distance ${(1 - maxSimilarity).toFixed(3)} > ${SIMILARITY_THRESHOLD}. Assigned to ${writer.name} (score: ${writer.performance_score.toFixed(2)}).`,
      };
      assignments.push(assignment);
    }

    await this.log({
      stage: 'editor:assignments',
      inputSummary: {
        brief_count: briefs.length,
        slots_remaining: slotsRemaining,
        writer_count: writers.length,
      },
      decisionSummary: {
        assigned: assignments.length,
        rejected_cooldown: rejectedCooldown,
        rejected_similarity: rejectedSimilarity,
        assigned_keywords: assignments.map((a) => a.brief.primary_keyword),
      },
      reasoningSummary: `Assigned ${assignments.length}/${briefs.length} briefs. Rejected: ${rejectedCooldown} cooldown, ${rejectedSimilarity} similarity. ${slotsRemaining - assignments.length} weekly slots remain unused.`,
    });

    return assignments;
  }
}
