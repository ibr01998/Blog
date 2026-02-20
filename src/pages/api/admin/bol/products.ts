import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db/postgres';
import type { BolProductRow } from '../../../../lib/bol/types';

export const GET: APIRoute = async ({ url }) => {
  try {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') ?? '0');
    const available = url.searchParams.get('available');

    let sql = 'SELECT * FROM bol_products';
    const params: unknown[] = [];

    if (available === 'true') {
      sql += ' WHERE is_available = true';
    } else if (available === 'false') {
      sql += ' WHERE is_available = false';
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const products = await query<BolProductRow>(sql, params);

    const countResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM bol_products'
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

    // Check for duplicate EAN (if provided)
    if (p.ean) {
      const existing = await query(
        'SELECT id FROM bol_products WHERE ean = $1 LIMIT 1',
        [p.ean]
      );
      if (existing.length > 0) {
        return new Response(
          JSON.stringify({ error: 'Product met dit EAN bestaat al', existingId: (existing[0] as any).id }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const source = p.rawApiResponse ? 'api' : 'manual';
    const affiliateUrl = p.affiliateUrl
      || (p.ean ? `/go/bol-${p.ean}` : '');

    const priceHistory = p.price > 0
      ? JSON.stringify([{ price: p.price, date: new Date().toISOString() }])
      : '[]';

    const result = await query<{ id: string }>(
      `INSERT INTO bol_products (
        ean, bol_product_id, title, brand, category,
        current_price, list_price, currency,
        rating, review_count, availability, delivery_label,
        affiliate_url, image_url, features, description,
        offer_condition, country_code,
        raw_api_response, selection_reasoning,
        price_history, source
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18,
        $19, $20,
        $21, $22
      ) RETURNING id`,
      [
        p.ean ?? '',
        p.bolProductId ?? p.bol_product_id ?? '',
        p.title,
        p.brand ?? '',
        p.category ?? '',
        p.price ?? 0,
        p.listPrice ?? p.list_price ?? null,
        p.currency ?? 'EUR',
        p.rating ?? 0,
        p.reviewCount ?? p.review_count ?? 0,
        p.availability ?? 'Unknown',
        p.deliveryLabel ?? p.delivery_label ?? '',
        affiliateUrl,
        p.imageUrl ?? p.image_url ?? '',
        JSON.stringify(p.features ?? []),
        p.description ?? '',
        p.offerCondition ?? p.offer_condition ?? 'NEW',
        p.countryCode ?? p.country_code ?? 'BE',
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
