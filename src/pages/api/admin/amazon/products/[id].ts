import type { APIRoute } from 'astro';
import { query } from '../../../../../lib/db/postgres';
import { isConfigured, refreshProduct } from '../../../../../lib/amazon/client';
import type { AmazonProductRow, AmazonPerformanceRow } from '../../../../../lib/amazon/types';

export const GET: APIRoute = async ({ params }) => {
  try {
    const { id } = params;

    const products = await query<AmazonProductRow>(
      'SELECT * FROM amazon_products WHERE id = $1 LIMIT 1',
      [id]
    );

    if (products.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Product not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const performance = await query<AmazonPerformanceRow>(
      'SELECT * FROM amazon_performance WHERE product_id = $1 ORDER BY recorded_at DESC LIMIT 50',
      [id]
    );

    // Fetch linked article if exists
    let article = null;
    if (products[0].article_id) {
      const articles = await query(
        'SELECT id, title, slug, status, review_status, created_at FROM articles WHERE id = $1 LIMIT 1',
        [products[0].article_id]
      );
      article = articles[0] ?? null;
    }

    return new Response(
      JSON.stringify({ product: products[0], performance, article }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const { id } = params;
    const body = await request.json();

    // Refresh product data from API
    if (body.refresh === true) {
      if (!isConfigured()) {
        return new Response(
          JSON.stringify({ error: 'API not configured — cannot refresh' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const products = await query<AmazonProductRow>(
        'SELECT asin FROM amazon_products WHERE id = $1 LIMIT 1',
        [id]
      );

      if (products.length === 0 || !products[0].asin) {
        return new Response(
          JSON.stringify({ error: 'Product not found or has no ASIN' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const refreshed = await refreshProduct(products[0].asin);

      if (!refreshed) {
        await query(
          'UPDATE amazon_products SET is_available = false, updated_at = NOW() WHERE id = $1',
          [id]
        );
        return new Response(
          JSON.stringify({ success: true, available: false, message: 'Product no longer available' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Update product and append to price history
      await query(
        `UPDATE amazon_products SET
          title = $2, brand = $3, current_price = $4, list_price = $5,
          rating = $6, review_count = $7, availability = $8,
          prime_eligible = $9, affiliate_url = $10, image_url = $11,
          features = $12, is_available = true,
          price_history = price_history || $13::jsonb,
          raw_api_response = $14,
          updated_at = NOW()
        WHERE id = $1`,
        [
          id,
          refreshed.title, refreshed.brand, refreshed.price, refreshed.listPrice,
          refreshed.rating, refreshed.reviewCount, refreshed.availability,
          refreshed.primeEligible, refreshed.affiliateUrl, refreshed.imageUrl,
          JSON.stringify(refreshed.features),
          JSON.stringify([{ price: refreshed.price, date: new Date().toISOString() }]),
          JSON.stringify(refreshed.rawApiResponse),
        ]
      );

      return new Response(
        JSON.stringify({ success: true, available: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update availability
    if (body.is_available != null) {
      await query(
        'UPDATE amazon_products SET is_available = $2, updated_at = NOW() WHERE id = $1',
        [id, body.is_available]
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  try {
    const { id } = params;

    const result = await query(
      'DELETE FROM amazon_products WHERE id = $1 RETURNING id',
      [id]
    );

    if ((result as any[]).length === 0) {
      return new Response(
        JSON.stringify({ error: 'Product not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
