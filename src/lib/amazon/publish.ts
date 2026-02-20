/**
 * Amazon Article Publish Flow
 * Handles dual-write: Postgres articles table → Astro DB Post table.
 * Follows the exact pattern from the orchestrator and articles/[id].ts.
 */

import { query } from '../db/postgres';
import { generateEmbedding } from '../embeddings';
import type { GeneratedArticle, AmazonProductRow } from './types';

// ─── Slug Uniqueness ────────────────────────────────────────────────────────────

async function ensureUniqueSlug(slug: string): Promise<string> {
  const { getCollection } = await import('astro:content');
  const collections = await getCollection('blog');

  let candidate = slug;
  let suffix = 2;
  const maxAttempts = 20;

  for (let i = 0; i < maxAttempts; i++) {
    const pgExists = await query(
      `SELECT id FROM articles WHERE slug = $1 LIMIT 1`,
      [candidate]
    );
    const collectionExists = collections.some((p: any) => p.slug === candidate);

    if (pgExists.length === 0 && !collectionExists) {
      return candidate;
    }

    candidate = `${slug}-${suffix}`;
    suffix++;
  }

  // Fallback: append timestamp
  return `${slug}-${Date.now()}`;
}

// ─── Publish ────────────────────────────────────────────────────────────────────

export interface PublishResult {
  articleId: string;
  slug: string;
}

/**
 * Publish an Amazon article to Postgres (and optionally Astro DB).
 * Links the article to the source product(s).
 */
export async function publishAmazonArticle(
  article: GeneratedArticle,
  productIds: string[],
  autoPublish = false
): Promise<PublishResult> {
  // 1. Generate embedding
  const embeddingInput = [
    article.primaryKeyword,
    article.title,
    article.articleMarkdown.substring(0, 2000),
  ].join(' ');
  const embedding = await generateEmbedding(embeddingInput);

  // 2. Ensure unique slug
  const uniqueSlug = await ensureUniqueSlug(article.slug);

  // 3. INSERT to Postgres articles table
  const articleId = crypto.randomUUID();
  await query(
    `INSERT INTO articles (
      id, title, slug, language, writer_id,
      content_tier, primary_keyword, intent, hook_type, format_type,
      word_count, article_markdown, meta_description, meta_title,
      image_url, embedding, status, review_status
    ) VALUES (
      $1, $2, $3, $4, NULL,
      $5, $6, $7, $8, $9,
      $10, $11, $12, $13,
      $14, $15::vector, $16, $17
    )`,
    [
      articleId,
      article.title,
      uniqueSlug,
      article.language,
      'money',
      article.primaryKeyword,
      'amazon-review',
      'benefit',
      'review',
      article.wordCount,
      article.articleMarkdown,
      article.metaDescription,
      article.metaTitle,
      article.heroImage || null,
      JSON.stringify(embedding),
      autoPublish ? 'published' : 'draft',
      autoPublish ? 'approved' : 'pending',
    ]
  );

  // 4. Link products to this article
  for (const productId of productIds) {
    await query(
      `UPDATE amazon_products SET article_id = $1, updated_at = NOW() WHERE id = $2`,
      [articleId, productId]
    );
  }

  // 5. Create initial article_metrics row
  await query(
    `INSERT INTO article_metrics (article_id) VALUES ($1)`,
    [articleId]
  );

  // 6. If auto-publish, write to Astro DB Post table
  if (autoPublish) {
    try {
      const { db, Post } = await import('astro:db');

      await db.insert(Post).values({
        slug: uniqueSlug,
        title: article.title,
        description: article.metaDescription,
        body: article.articleMarkdown,
        pubDate: new Date(),
        target_keyword: article.primaryKeyword,
        seo_title: article.metaTitle,
        article_type: 'amazon-review',
        heroImage: article.heroImage || '',
        platforms: '[]',
        blocks: '[]',
        status: 'published',
      }).onConflictDoUpdate({
        target: Post.slug,
        set: {
          body: article.articleMarkdown,
          title: article.title,
          description: article.metaDescription,
          status: 'published',
        },
      });
    } catch (err) {
      // Rollback Postgres to draft on Astro DB failure
      await query(
        `UPDATE articles SET status = 'draft', review_status = 'pending' WHERE id = $1`,
        [articleId]
      );
      throw new Error(`Auto-publish failed (Astro DB write error). Article saved as draft. ${err}`);
    }
  }

  return { articleId, slug: uniqueSlug };
}
