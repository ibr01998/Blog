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
import { generateAndInsertBodyImages, generateHeroImage, generateAllImages } from '../../../../lib/images.ts';

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
  author: string;
  reading_time: number;
  body_images: string;
  fact_check_status: string;
  fact_check_issues: string;
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
    author: article.author || 'Redactie',
    readingTime: article.reading_time || 6,
  }).onConflictDoUpdate({
    target: Post.slug,
    set: {
      body: article.article_markdown,
      title: article.title,
      description: article.meta_description || '',
      heroImage: article.image_url || '',
      platforms,
      status: 'published',
      author: article.author || 'Redactie',
      readingTime: article.reading_time || 6,
    },
  });
}

export const GET: APIRoute = async ({ params, request }) => {
  const { id } = params;
  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'json';

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

    const article = articles[0];

    // Count images in the article body
    const bodyImageMatches = article.article_markdown.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || [];
    const bodyImageCount = bodyImageMatches.length;
    const bodyImageUrls = bodyImageMatches.map((match: string) => {
      const urlMatch = match.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      return urlMatch ? urlMatch[2] : null;
    }).filter((url): url is string => Boolean(url));

    // If preview format requested, return rendered HTML
    if (format === 'preview') {
      // Simple markdown to HTML conversion (we'll use basic regex for now to avoid extra deps)
      let renderedHtml = article.article_markdown
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Headers
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Bold and italic
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Images (keep as img tags)
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="article-image" />')
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        // Lists (simple handling)
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        // Paragraphs
        .split('\n\n')
        .map((para: string) => {
          if (para.startsWith('<h') || para.startsWith('<li') || para.startsWith('<img') || para.startsWith('<')) {
            return para;
          }
          return `<p>${para}</p>`;
        })
        .join('\n');

      // Wrap lists
      renderedHtml = renderedHtml.replace(/(<li>.+<\/li>\n?)+/g, '<ul>$&</ul>');

      const previewHtml = `
        <div class="preview-container">
          ${article.image_url ? `
            <div class="preview-hero">
              <img src="${article.image_url}" alt="${article.title}" />
            </div>
          ` : '<div class="preview-no-image">⚠️ Geen hero afbeelding</div>'}
          
          <header class="preview-header">
            <h1>${article.title}</h1>
            <div class="preview-meta">
              <span>${article.author || 'Redactie'}</span>
              <span>·</span>
              <span>${new Date(article.created_at).toLocaleDateString('nl-NL')}</span>
              <span>·</span>
              <span>${article.reading_time || 6} min leestijd</span>
            </div>
            ${article.meta_description ? `<p class="preview-description">${article.meta_description}</p>` : ''}
          </header>
          
          <div class="preview-content">
            ${renderedHtml}
          </div>
          
          <div class="preview-image-summary">
            <h4>📸 Afbeeldingen in dit artikel</h4>
            <div class="image-stats">
              <span class="stat ${article.image_url ? 'ok' : 'missing'}">
                Hero: ${article.image_url ? '✓' : '✗'}
              </span>
              <span class="stat ${bodyImageCount >= 2 ? 'ok' : bodyImageCount > 0 ? 'partial' : 'missing'}">
                Body: ${bodyImageCount}/2
              </span>
              <span class="stat total">
                Totaal: ${(article.image_url ? 1 : 0) + bodyImageCount}
              </span>
            </div>
            ${bodyImageUrls.length > 0 ? `
              <div class="body-image-thumbnails">
                ${bodyImageUrls.map((url: string) => `<img src="${url}" class="thumbnail" />`).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      `;

      return new Response(JSON.stringify({
        article: {
          id: article.id,
          title: article.title,
          slug: article.slug,
          image_url: article.image_url,
          body_image_count: bodyImageCount,
          body_image_urls: bodyImageUrls,
          has_hero_image: !!article.image_url,
          total_images: bodyImageCount + (article.image_url ? 1 : 0),
        },
        previewHtml,
        rawMarkdown: article.article_markdown,
      }), {
        status: 200,
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

    // Add image stats to response
    const articleWithStats = {
      ...article,
      body_image_count: bodyImageCount,
      body_image_urls: bodyImageUrls,
      total_images: bodyImageCount + (article.image_url ? 1 : 0),
    };

    return new Response(JSON.stringify({ article: articleWithStats, logs }), {
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

    // Auto-generate images if publishing: hero image + body images (in parallel)
    // PREDICTABLE: Always generates 1 hero + exactly 2 body images
    if (shouldPublish && updatedArticle) {
      const origin = new URL(request.url).origin;

      try {
        // Build parallel image generation tasks
        const imagePromises: Promise<void>[] = [];

        // Hero image generation (if missing) - ALWAYS generates 1 hero image
        if (!updatedArticle.image_url) {
          imagePromises.push(
            (async () => {
              const heroResult = await generateHeroImage({
                title: updatedArticle.title,
                keyword: updatedArticle.primary_keyword,
                slug: updatedArticle.slug,
                origin,
                style: 'halftone',
              });
              
              if (heroResult.success && heroResult.url) {
                const imgResult = await query<ArticleRow>(
                  `UPDATE articles SET image_url = $1 WHERE id = $2 RETURNING *`,
                  [heroResult.url, id]
                );
                if (imgResult[0]) updatedArticle = imgResult[0];
              } else {
                console.warn('[articles/[id]] Auto hero image generation failed:', heroResult.error);
              }
            })()
          );
        }

        // Body image generation - ALWAYS generates exactly 2 contextual images under H2 sections
        imagePromises.push(
          (async () => {
            const bodyResult = await generateAndInsertBodyImages({
              markdown: updatedArticle.article_markdown,
              title: updatedArticle.title,
              keyword: updatedArticle.primary_keyword,
              slug: updatedArticle.slug,
              origin,
              targetCount: 2, // PREDICTABLE: Always aim for 2 body images
            });
            
            // Update article markdown with inserted body images
            const bodyImgResult = await query<ArticleRow>(
              `UPDATE articles SET article_markdown = $1, body_images = $2 WHERE id = $3 RETURNING *`,
              [bodyResult.markdown, JSON.stringify(bodyResult.bodyImages), id]
            );
            if (bodyImgResult[0]) updatedArticle = bodyImgResult[0];
            
            // Log if we couldn't generate the full 2 images
            if (bodyResult.count < 2) {
              console.warn(`[articles/[id]] Only generated ${bodyResult.count}/2 body images for ${updatedArticle.slug}`);
            }
          })()
        );

        await Promise.all(imagePromises);
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

/**
 * POST /api/admin/articles/[id] 
 * Dedicated endpoint for generating all images for an article.
 * Body: { forceRegenerate?: boolean }
 * 
 * Generates:
 * - 1 Hero image (if missing or forceRegenerate)
 * - 2 Body images (placed after H2 sections)
 */
export const POST: APIRoute = async ({ params, request }) => {
  const { id } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const { forceRegenerate = false } = body;

    // Fetch the article
    const articles = await query<ArticleRow>(
      `SELECT id, title, slug, primary_keyword, article_markdown, image_url
       FROM articles WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (articles.length === 0) {
      return new Response(JSON.stringify({ error: 'Article not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const article = articles[0];
    const origin = new URL(request.url).origin;

    // Use the predictable image generation
    const result = await generateAllImages({
      markdown: article.article_markdown,
      title: article.title,
      keyword: article.primary_keyword,
      slug: article.slug,
      origin,
      existingHeroImage: article.image_url,
      forceRegenerateHero: forceRegenerate,
    });

    // Update the article in database
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    // Update hero image if we generated one
    if (result.heroImage && (forceRegenerate || result.heroImage !== article.image_url)) {
      updates.push(`image_url = $${paramIdx++}`);
      values.push(result.heroImage);
    }

    // Update markdown if body images were inserted
    if (result.bodyImages.length > 0 && result.updatedMarkdown !== article.article_markdown) {
      updates.push(`article_markdown = $${paramIdx++}`);
      values.push(result.updatedMarkdown);
      updates.push(`body_images = $${paramIdx++}`);
      values.push(JSON.stringify(result.bodyImages));
    }

    let updatedArticle = article;
    if (updates.length > 0) {
      values.push(id);
      const dbResult = await query<ArticleRow>(
        `UPDATE articles SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
        values
      );
      if (dbResult[0]) updatedArticle = dbResult[0];
    }

    return new Response(JSON.stringify({
      success: true,
      heroImage: result.heroImage,
      bodyCount: result.bodyImages.length,
      bodyImages: result.bodyImages,
      status: result.status,
      errors: result.errors,
      article: updatedArticle,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[generate-images POST] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : String(error) 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
