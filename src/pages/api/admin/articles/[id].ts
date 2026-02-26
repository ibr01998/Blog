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
      // Convert markdown to HTML with proper article styling matching the blog
      let renderedHtml = article.article_markdown
        // Escape HTML first
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Headers (H1-H3, skipping H1 as it's the title)
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Bold and italic
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Images - use exact blog styling
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" decoding="async" />')
        // Links with blog styling
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="affiliate-link">$1</a>')
        // Lists
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        // Blockquotes
        .replace(/^&gt; (.+)$/gm, '<blockquote><p>$1</p></blockquote>')
        // Code inline
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Tables (basic support)
        .replace(/\|(.+)\|/g, (match: string) => {
          if (match.includes('---')) return '';
          const cells = match.split('|').filter((c: string) => c.trim());
          return '<tr>' + cells.map((c: string) => `<td>${c.trim()}</td>`).join('') + '</tr>';
        });

      // Wrap table rows in table structure
      renderedHtml = renderedHtml.replace(/(<tr>.+<\/tr>\n?)+/g, '<table class="data-table"><tbody>$&</tbody></table>');

      // Process paragraphs (split by blank lines)
      const lines = renderedHtml.split('\n');
      const processedLines: string[] = [];
      let inParagraph = false;
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip empty lines
        if (!trimmed) {
          if (inParagraph) {
            processedLines.push('</p>');
            inParagraph = false;
          }
          continue;
        }
        
        // Skip if already wrapped in HTML tags
        if (trimmed.startsWith('<h') || trimmed.startsWith('<li') || 
            trimmed.startsWith('<img') || trimmed.startsWith('<') && !trimmed.startsWith('<p>')) {
          if (inParagraph) {
            processedLines.push('</p>');
            inParagraph = false;
          }
          processedLines.push(line);
          continue;
        }
        
        // Start or continue paragraph
        if (!inParagraph) {
          processedLines.push('<p>' + line);
          inParagraph = true;
        } else {
          processedLines.push(line);
        }
      }
      
      if (inParagraph) {
        processedLines.push('</p>');
      }
      
      renderedHtml = processedLines.join('\n');

      // Wrap lists properly
      renderedHtml = renderedHtml.replace(/(<li>.+<\/li>\n?)+/gs, '<ul>$&</ul>');

      // Build the complete preview HTML with exact blog styling
      const pubDateStr = new Date(article.created_at).toLocaleDateString('nl-NL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const previewHtml = `
        <div class="article-preview-wrapper" style="font-family: 'Outfit', sans-serif; background: #fff; max-width: 100%;">
          <!-- Hero Section -->
          ${article.image_url ? `
            <div class="preview-hero" style="width: 100%; height: 300px; overflow: hidden; border-radius: 12px 12px 0 0; margin-bottom: 0;">
              <img src="${article.image_url}" alt="${article.title}" style="width: 100%; height: 100%; object-fit: cover; filter: grayscale(100%) contrast(1.1);" />
            </div>
          ` : `
            <div class="preview-no-image" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px dashed #f59e0b; border-radius: 12px; padding: 2rem; text-align: center; color: #92400e; margin-bottom: 1.5rem;">
              <svg style="width: 48px; height: 48px; margin-bottom: 0.5rem; opacity: 0.5;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
              <p style="margin: 0; font-weight: 500;">Geen hero afbeelding</p>
            </div>
          `}
          
          <!-- Glass Header Card (matching blog) -->
          <div class="preview-header-card" style="background: rgba(255,255,255,0.85); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.5); border-radius: 16px; padding: 2rem; margin: -2rem 1.5rem 2rem; position: relative; z-index: 10; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
            <!-- Breadcrumbs -->
            <nav style="display: flex; font-size: 0.875rem; color: #6b7280; margin-bottom: 1rem;">
              <span style="color: #1B2D4F; font-weight: 500;">Home</span>
              <span style="margin: 0 0.5rem; opacity: 0.4;">/</span>
              <span style="color: #1B2D4F; font-weight: 500;">Blog</span>
              <span style="margin: 0 0.5rem; opacity: 0.4;">/</span>
              <span style="color: #6b7280; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${article.title}</span>
            </nav>
            
            <!-- Date Badge -->
            <span style="display: inline-block; background: #1B2D4F; color: #fff; padding: 0.375rem 1rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1rem;">
              ${pubDateStr}
            </span>
            
            <!-- Title -->
            <h1 style="font-size: 2.25rem; font-weight: 800; color: #1B2D4F; line-height: 1.1; margin: 0 0 1rem; letter-spacing: -0.02em;">${article.title}</h1>
            
            <!-- Meta -->
            <div style="display: flex; align-items: center; gap: 0.75rem; font-size: 0.875rem; color: #6b7280; flex-wrap: wrap;">
              <span style="font-weight: 600; color: #1B2D4F;">${article.author || 'Redactie'}</span>
              <span style="opacity: 0.4;">·</span>
              <time datetime="${article.created_at}">${pubDateStr}</time>
              <span style="opacity: 0.4;">·</span>
              <span>${article.reading_time || 6} min leestijd</span>
            </div>
          </div>
          
          <!-- Article Content (matching blog styling) -->
          <div class="preview-content-wrapper" style="max-width: 65ch; margin: 0 auto; padding: 0 1.5rem 3rem;">
            <!-- Description/Summary -->
            ${article.meta_description ? `
              <div style="background: #f9fafb; border-left: 4px solid #1B2D4F; padding: 1.25rem; margin-bottom: 2rem; border-radius: 0 8px 8px 0;">
                <p style="margin: 0; font-size: 1.125rem; font-style: italic; color: #4b5563; line-height: 1.6;">${article.meta_description}</p>
              </div>
            ` : ''}
            
            <!-- Main Content -->
            <article class="article-content" style="font-size: 1.125rem; line-height: 1.85; color: #374151;">
              ${renderedHtml}
            </article>
          </div>
          
          <!-- Image Summary Panel -->
          <div class="preview-image-summary" style="background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 1.5rem; margin-top: 2rem;">
            <h4 style="margin: 0 0 1rem; font-weight: 600; color: #1B2D4F; display: flex; align-items: center; gap: 0.5rem;">
              <svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
              Afbeeldingen in dit artikel
            </h4>
            <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem;">
              <span style="padding: 0.375rem 0.875rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 500; ${article.image_url ? 'background: #d1fae5; color: #065f46;' : 'background: #fee2e2; color: #991b1b;'}">
                Hero: ${article.image_url ? '✓' : '✗'}
              </span>
              <span style="padding: 0.375rem 0.875rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 500; ${bodyImageCount >= 2 ? 'background: #d1fae5; color: #065f46;' : bodyImageCount > 0 ? 'background: #fef3c7; color: #92400e;' : 'background: #fee2e2; color: #991b1b;'}">
                Body: ${bodyImageCount}/2
              </span>
              <span style="padding: 0.375rem 0.875rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 500; background: #e0e7ff; color: #3730a3;">
                Totaal: ${(article.image_url ? 1 : 0) + bodyImageCount}/3
              </span>
            </div>
            ${bodyImageUrls.length > 0 ? `
              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                ${bodyImageUrls.map((url: string) => `
                  <div style="width: 100px; height: 75px; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
                    <img src="${url}" style="width: 100%; height: 100%; object-fit: cover;" />
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
          
          <!-- Article Content Styles -->
          <style>
            .article-content h1 { 
              font-size: 1.75rem; 
              font-weight: 800; 
              color: #1B2D4F; 
              margin: 2.5rem 0 1rem; 
              line-height: 1.2;
              letter-spacing: -0.02em;
            }
            .article-content h2 { 
              font-size: 1.5rem; 
              font-weight: 700; 
              color: #1B2D4F; 
              margin: 2.5rem 0 1rem; 
              line-height: 1.2;
            }
            .article-content h3 { 
              font-size: 1.25rem; 
              font-weight: 700; 
              color: #1B2D4F; 
              margin: 2rem 0 0.75rem; 
              line-height: 1.3;
            }
            .article-content p { 
              margin-bottom: 1.75rem; 
              color: #3a4a5c;
            }
            .article-content p:first-of-type {
              font-size: 1.2rem;
              color: #1B2D4F;
              font-weight: 500;
            }
            .article-content ul, .article-content ol { 
              margin: 1.5rem 0 2rem; 
              padding-left: 1.5rem; 
              color: #3a4a5c;
            }
            .article-content ul { list-style-type: disc; }
            .article-content ol { list-style-type: decimal; }
            .article-content li { 
              margin-bottom: 0.75rem; 
              line-height: 1.75;
            }
            .article-content li::marker { 
              color: #1B2D4F; 
              font-weight: bold; 
            }
            .article-content strong { 
              color: #1B2D4F; 
              font-weight: 700; 
            }
            .article-content a {
              color: #1B2D4F;
              font-weight: 600;
              text-decoration: underline;
              text-underline-offset: 3px;
              text-decoration-color: rgba(27, 45, 79, 0.3);
            }
            .article-content a:hover {
              opacity: 0.6;
            }
            .article-content img {
              width: 100%;
              max-width: 100%;
              height: auto;
              border-radius: 8px;
              margin: 2.5rem 0;
              border: 1px solid #e5e7eb;
              filter: grayscale(100%) contrast(1.05);
            }
            .article-content blockquote {
              border-left: 3px solid #1B2D4F;
              padding-left: 1.5rem;
              margin: 2.5rem 0;
              font-style: italic;
              font-size: 1.125rem;
              color: #1B2D4F;
            }
            .article-content blockquote p {
              font-size: 1.125rem !important;
              color: #1B2D4F !important;
              margin-bottom: 0;
            }
            .article-content table {
              width: 100%;
              border-collapse: collapse;
              margin: 2rem 0;
              font-size: 0.95rem;
            }
            .article-content thead {
              background: #1B2D4F;
              color: #fff;
            }
            .article-content th {
              text-align: left;
              padding: 0.875rem 1rem;
              font-weight: 700;
              text-transform: uppercase;
              font-size: 0.75rem;
              letter-spacing: 0.05em;
            }
            .article-content td {
              padding: 0.875rem 1rem;
              border-bottom: 1px solid #e5e7eb;
              color: #3a4a5c;
            }
            .article-content tbody tr:last-child td {
              border-bottom: none;
            }
            .article-content code {
              background: #f3f4f6;
              padding: 0.2rem 0.4rem;
              border-radius: 4px;
              font-family: monospace;
              font-size: 0.9em;
            }
            .article-content hr {
              border: none;
              height: 1px;
              background: #e5e7eb;
              margin: 3rem 0;
            }
          </style>
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
