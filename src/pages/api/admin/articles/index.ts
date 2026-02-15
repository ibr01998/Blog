/**
 * GET /api/admin/articles
 *
 * Returns paginated list of AI-generated articles.
 * Query params:
 *   - status: 'draft' | 'approved' | 'published' (optional)
 *   - review_status: 'pending' | 'approved' | 'rejected' (optional)
 *   - limit: number (default 20)
 *   - offset: number (default 0)
 *
 * Protected by dashboard session cookie (via middleware.ts).
 */

import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db/postgres.ts';

export const GET: APIRoute = async ({ url }) => {
  try {
    const params = url.searchParams;
    const status = params.get('status');
    const reviewStatus = params.get('review_status');
    const limit = Math.min(parseInt(params.get('limit') ?? '20'), 100);
    const offset = parseInt(params.get('offset') ?? '0');

    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`a.status = $${paramIdx++}`);
      values.push(status);
    }
    if (reviewStatus) {
      conditions.push(`a.review_status = $${paramIdx++}`);
      values.push(reviewStatus);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count for pagination
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM articles a ${where}`,
      values
    );
    const total = parseInt(countRows[0]?.count ?? '0');

    // Get paginated articles with writer name
    const articles = await query(
      `SELECT
         a.id, a.title, a.slug, a.language, a.content_tier,
         a.primary_keyword, a.intent, a.hook_type, a.format_type,
         a.word_count, a.meta_description, a.meta_title,
         a.status, a.review_status, a.human_notes,
         a.published_at, a.created_at,
         ag.name as writer_name, ag.id as writer_id
       FROM articles a
       LEFT JOIN agents ag ON a.writer_id = ag.id
       ${where}
       ORDER BY
         CASE a.review_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
         a.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    );

    return new Response(JSON.stringify({ articles, total, limit, offset }), {
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
