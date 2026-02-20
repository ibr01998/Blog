import type { APIRoute } from 'astro';
import { query } from '../../../../../lib/db/postgres';
import { isConfigured, refreshProduct } from '../../../../../lib/bol/client';
import type { BolProductRow, BolPerformanceRow } from '../../../../../lib/bol/types';

export const GET: APIRoute = async ({ params }) => {
  try {
    const { id } = params;

    const products = await query<BolProductRow>(
      'SELECT * FROM bol_products WHERE id = $1 LIMIT 1',
      [id]
    );

    if (products.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Product niet gevonden' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const performance = await query<BolPerformanceRow>(
      'SELECT * FROM bol_performance WHERE product_id = $1 ORDER BY recorded_at DESC LIMIT 50',
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
          JSON.stringify({ error: 'API niet geconfigureerd — kan niet vernieuwen' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const products = await query<BolProductRow>(
        'SELECT ean, country_code FROM bol_products WHERE id = $1 LIMIT 1',
        [id]
      );

      if (products.length === 0 || !products[0].ean) {
        return new Response(
          JSON.stringify({ error: 'Product niet gevonden of heeft geen EAN' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const refreshed = await refreshProduct(
        products[0].ean,
        (products[0].country_code as 'BE' | 'NL') || 'BE'
      );

      if (!refreshed) {
        await query(
          'UPDATE bol_products SET is_available = false, updated_at = NOW() WHERE id = $1',
          [id]
        );
        return new Response(
          JSON.stringify({ success: true, available: false, message: 'Product niet meer beschikbaar' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Update product and append to price history
      await query(
        `UPDATE bol_products SET
          title = $2, brand = $3, current_price = $4, list_price = $5,
          rating = $6, review_count = $7, availability = $8,
          delivery_label = $9, affiliate_url = $10, image_url = $11,
          features = $12, is_available = true,
          price_history = price_history || $13::jsonb,
          raw_api_response = $14,
          updated_at = NOW()
        WHERE id = $1`,
        [
          id,
          refreshed.title, refreshed.brand, refreshed.price, refreshed.listPrice,
          refreshed.rating, refreshed.reviewCount, refreshed.availability,
          refreshed.deliveryLabel, refreshed.affiliateUrl, refreshed.imageUrl,
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
        'UPDATE bol_products SET is_available = $2, updated_at = NOW() WHERE id = $1',
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
      'DELETE FROM bol_products WHERE id = $1 RETURNING id',
      [id]
    );

    if ((result as any[]).length === 0) {
      return new Response(
        JSON.stringify({ error: 'Product niet gevonden' }),
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
