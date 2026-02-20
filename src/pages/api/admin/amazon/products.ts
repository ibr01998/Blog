import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db/postgres';
import type { AmazonProductRow } from '../../../../lib/amazon/types';

export const GET: APIRoute = async ({ url }) => {
  try {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') ?? '0');
    const available = url.searchParams.get('available');

    let sql = 'SELECT * FROM amazon_products';
    const params: unknown[] = [];

    if (available === 'true') {
      sql += ' WHERE is_available = true';
    } else if (available === 'false') {
      sql += ' WHERE is_available = false';
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const products = await query<AmazonProductRow>(sql, params);

    const countResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM amazon_products'
    );
    const total = parseInt(countResult[0]?.count ?? '0');

    return new Response(
      JSON.stringify({ products, total }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const p = body.product;

    if (!p || !p.title) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: product.title' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check for duplicate ASIN (if provided)
    if (p.asin) {
      const existing = await query(
        'SELECT id FROM amazon_products WHERE asin = $1 LIMIT 1',
        [p.asin]
      );
      if (existing.length > 0) {
        return new Response(
          JSON.stringify({ error: 'Product with this ASIN already exists', existingId: (existing[0] as any).id }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const source = p.rawApiResponse ? 'api' : 'manual';
    const affiliateUrl = p.affiliateUrl
      || (p.asin ? `/go/amazon-${p.asin}` : '');

    const priceHistory = p.price > 0
      ? JSON.stringify([{ price: p.price, date: new Date().toISOString() }])
      : '[]';

    const result = await query<{ id: string }>(
      `INSERT INTO amazon_products (
        asin, title, brand, category,
        current_price, list_price, currency,
        rating, review_count, availability, prime_eligible,
        affiliate_url, image_url, features, description,
        best_seller_rank, raw_api_response, selection_reasoning,
        price_history, source
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18,
        $19, $20
      ) RETURNING id`,
      [
        p.asin ?? '',
        p.title,
        p.brand ?? '',
        p.category ?? '',
        p.price ?? 0,
        p.listPrice ?? p.list_price ?? null,
        p.currency ?? 'EUR',
        p.rating ?? 0,
        p.reviewCount ?? p.review_count ?? 0,
        p.availability ?? 'Unknown',
        p.primeEligible ?? p.prime_eligible ?? false,
        affiliateUrl,
        p.imageUrl ?? p.image_url ?? '',
        JSON.stringify(p.features ?? []),
        p.description ?? '',
        p.bestSellerRank ?? p.best_seller_rank ?? null,
        JSON.stringify(p.rawApiResponse ?? p.raw_api_response ?? {}),
        p.selectionReasoning ?? p.selection_reasoning ?? '',
        priceHistory,
        source,
      ]
    );

    return new Response(
      JSON.stringify({ success: true, id: result[0]?.id }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
