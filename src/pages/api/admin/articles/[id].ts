/**
 * GET   /api/admin/articles/[id]  — Get single article with full markdown + agent logs
 * PATCH /api/admin/articles/[id]  — Update article (approve/reject/notes/publish)
 *
 * PATCH cases:
 *   { review_status: 'approved' }
 *     → Updates Postgres articles table
 *     → If system_config.auto_publish_enabled: also publishes to Astro DB Post table
 *   { review_status: 'rejected', human_notes: '...' }
 *     → Postgres only
 *   { status: 'published' }
 *     → Manual publish → writes to BOTH Postgres (articles) AND Astro DB (Post)
 *   { human_notes: '...' }
 *     → Postgres only
 *
 * IMPORTANT: This file imports 'astro:db' for the dual-write to the Post table.
 * The orchestrator does NOT do this — only this API route does.
 *
 * Protected by dashboard session cookie (via middleware.ts).
 */

import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db/postgres.ts';
import { db, Post, Platform, inArray } from 'astro:db';

interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  language: string;
  writer_id: string;
  content_tier: string;
  primary_keyword: string;
  intent: string;
  hook_type: string;
  format_type: string;
  word_count: number;
  article_markdown: string;
  meta_description: string;
  meta_title: string;
  status: string;
  review_status: string;
  image_url: string | null;
  human_notes: string | null;
  published_at: string | null;
  created_at: string;
}

/**
 * Write an approved/published article to the Astro DB Post table
 * so it appears in the existing public-facing blog.
 */
/** Extract unique /go/{slug} platform slugs from article markdown */
function extractPlatformSlugs(markdown: string): string[] {
  const matches = [...markdown.matchAll(/\/go\/([a-zA-Z0-9_-]+)/g)];
  return [...new Set(matches.map((m) => m[1].toLowerCase()))];
}

async function publishToPostTable(article: ArticleRow): Promise<void> {
  const extractedPlatforms = extractPlatformSlugs(article.article_markdown);

  // Validate that all extracted platform slugs actually exist in Platform table
  let platforms: string[] = [];
  if (extractedPlatforms.length > 0) {
    const validPlatforms = await db.select().from(Platform).where(
      inArray(Platform.slug, extractedPlatforms)
    );
    const validSlugs = new Set(validPlatforms.map(p => p.slug));
    platforms = extractedPlatforms.filter(slug => validSlugs.has(slug));

    // Log warning if some platforms were invalid
    const invalidPlatforms = extractedPlatforms.filter(slug => !validSlugs.has(slug));
    if (invalidPlatforms.length > 0) {
      console.warn(`[publishToPostTable] Invalid platform slugs in article ${article.slug}:`, invalidPlatforms);
    }
  }

  await db.insert(Post).values({
    slug: article.slug,
    title: article.title,
    description: article.meta_description || '',
    body: article.article_markdown,
    pubDate: new Date(),
    target_keyword: article.primary_keyword,
    seo_title: article.meta_title || article.title,
    article_type: article.format_type as any,
    heroImage: article.image_url || '',
    platforms,
    status: 'published',
  }).onConflictDoUpdate({
    target: Post.slug,
    set: {
      body: article.article_markdown,
      title: article.title,
      description: article.meta_description || '',
      heroImage: article.image_url || '',
      platforms,
      status: 'published',
    },
  });
}

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;

  try {
    const articles = await query<ArticleRow>(
      `SELECT a.*, ag.name as writer_name
       FROM articles a
       LEFT JOIN agents ag ON a.writer_id = ag.id
       WHERE a.id = $1 LIMIT 1`,
      [id]
    );

    if (articles.length === 0) {
      return new Response(JSON.stringify({ error: 'Article not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get all agent logs for this article
    const logs = await query(
      `SELECT al.*, ag.name as agent_name, ag.role as agent_role
       FROM agent_logs al
       LEFT JOIN agents ag ON al.agent_id = ag.id
       WHERE al.article_id = $1
       ORDER BY al.created_at ASC`,
      [id]
    );

    return new Response(JSON.stringify({ article: articles[0], logs }), {
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
    const { review_status, status, human_notes, image_url } = body;

    // Fetch current article state
    const current = await query<ArticleRow>(
      `SELECT * FROM articles WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (current.length === 0) {
      return new Response(JSON.stringify({ error: 'Article not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const article = current[0];
    let shouldPublish = false;

    // Build updates
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (review_status !== undefined) {
      updates.push(`review_status = $${paramIdx++}`);
      values.push(review_status);

      // Auto-publish: if approving AND auto_publish_enabled, also set status=published
      if (review_status === 'approved') {
        const configRows = await query<{ auto_publish_enabled: boolean }>(
          'SELECT auto_publish_enabled FROM system_config WHERE id = 1 LIMIT 1'
        );
        if (configRows[0]?.auto_publish_enabled) {
          shouldPublish = true;
        }
      }
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIdx++}`);
      values.push(status);
      if (status === 'published') {
        shouldPublish = true;
        updates.push(`published_at = $${paramIdx++}`);
        values.push(new Date().toISOString());
      }
    }

    if (human_notes !== undefined) {
      updates.push(`human_notes = $${paramIdx++}`);
      values.push(human_notes);
    }
    if (image_url !== undefined) {
      updates.push(`image_url = $${paramIdx++}`);
      values.push(image_url);
    }

    if (shouldPublish && !updates.some((u) => u.startsWith('status'))) {
      updates.push(`status = $${paramIdx++}`);
      values.push('published');
      updates.push(`published_at = $${paramIdx++}`);
      values.push(new Date().toISOString());
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid fields to update' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    values.push(id);
    const result = await query<ArticleRow>(
      `UPDATE articles SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    let updatedArticle = result[0];

    // Auto-generate image if publishing and no image exists yet
    if (shouldPublish && updatedArticle && !updatedArticle.image_url) {
      try {
        const origin = new URL(request.url).origin;
        const imgRes = await fetch(`${origin}/api/generate/image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: updatedArticle.title,
            keyword: updatedArticle.primary_keyword,
            slug: updatedArticle.slug,
            provider: 'google',
            style: 'halftone',
          }),
        });
        const imgData = await imgRes.json() as { url?: string };
        if (imgRes.ok && imgData.url) {
          // Save image_url back to the article
          const imgResult = await query<ArticleRow>(
            `UPDATE articles SET image_url = $1 WHERE id = $2 RETURNING *`,
            [imgData.url, id]
          );
          if (imgResult[0]) updatedArticle = imgResult[0];
        } else {
          console.warn('[articles/[id]] Auto image generation failed:', imgData);
        }
      } catch (imgErr) {
        // Don't block publish if image generation fails
        console.warn('[articles/[id]] Auto image generation error:', imgErr);
      }
    }

    // Dual-write to Astro DB Post table if publishing
    if (shouldPublish && updatedArticle) {
      try {
        await publishToPostTable(updatedArticle);
      } catch (publishError) {
        // CRITICAL: Rollback Postgres to draft if Astro DB write fails
        console.error('[articles/[id]] Post table publish failed:', publishError);

        // Rollback the status in Postgres to prevent inconsistent state
        try {
          await query(
            `UPDATE articles SET status = 'draft', published_at = NULL WHERE id = $1`,
            [id]
          );
        } catch (rollbackError) {
          console.error('[articles/[id]] Rollback failed:', rollbackError);
        }

        return new Response(JSON.stringify({
          error: `Failed to publish article: ${publishError instanceof Error ? publishError.message : String(publishError)}`,
          details: 'Article status has been rolled back to draft. Please fix the issue and try publishing again.',
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ success: true, article: updatedArticle }), {
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
