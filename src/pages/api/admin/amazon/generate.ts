import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db/postgres';
import { generateAmazonArticle } from '../../../../lib/amazon/generator';
import { publishAmazonArticle } from '../../../../lib/amazon/publish';
import type { AmazonProductRow } from '../../../../lib/amazon/types';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const productIds: string[] = body.product_ids ?? (body.product_id ? [body.product_id] : []);
    const language = body.language ?? 'nl';
    const autoPublish = body.auto_publish ?? false;

    if (productIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: product_ids or product_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (productIds.length > 10) {
      return new Response(
        JSON.stringify({ error: 'Maximum 10 products per article' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fetch products
    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
    const products = await query<AmazonProductRow>(
      `SELECT * FROM amazon_products WHERE id IN (${placeholders})`,
      productIds
    );

    if (products.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No products found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check availability
    const unavailable = products.filter(p => !p.is_available);
    if (unavailable.length > 0) {
      return new Response(
        JSON.stringify({
          error: `${unavailable.length} product(s) are marked unavailable`,
          unavailable: unavailable.map(p => ({ id: p.id, title: p.title })),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if any product already has an article
    const withArticles = products.filter(p => p.article_id);
    if (withArticles.length > 0) {
      return new Response(
        JSON.stringify({
          error: `${withArticles.length} product(s) already have articles`,
          existing: withArticles.map(p => ({ id: p.id, title: p.title, article_id: p.article_id })),
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Generate article
    const article = await generateAmazonArticle(products, language);

    // Publish (draft or auto-publish)
    const result = await publishAmazonArticle(article, productIds.map(id => {
      const p = products.find(pr => pr.id === id);
      return p?.id ?? id;
    }), autoPublish);

    return new Response(
      JSON.stringify({
        success: true,
        article_id: result.articleId,
        slug: result.slug,
        title: article.title,
        word_count: article.wordCount,
        products_count: products.length,
        auto_published: autoPublish,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
