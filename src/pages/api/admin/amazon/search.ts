import type { APIRoute } from 'astro';
import { isConfigured, searchItems } from '../../../../lib/amazon/client';
import { filterProducts, DEFAULT_CRITERIA } from '../../../../lib/amazon/selection';
import { generateSelectionReasoning } from '../../../../lib/amazon/selection';

export const POST: APIRoute = async ({ request }) => {
  if (!isConfigured()) {
    return new Response(
      JSON.stringify({
        error: 'Amazon Creators API credentials not configured',
        hint: 'Set AMAZON_CREDENTIAL_ID, AMAZON_CREDENTIAL_SECRET, and AMAZON_PARTNER_TAG in Vercel environment variables. You need 10 qualifying sales to get API access.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();

    if (!body.keywords || typeof body.keywords !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing required field: keywords' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const results = await searchItems({
      keywords: body.keywords,
      category: body.category,
      minPrice: body.minPrice,
      maxPrice: body.maxPrice,
      itemCount: body.itemCount ?? 10,
    });

    const criteria = {
      ...DEFAULT_CRITERIA,
      ...(body.minRating != null ? { minRating: body.minRating } : {}),
      ...(body.minReviews != null ? { minReviews: body.minReviews } : {}),
      ...(body.minPrice != null ? { minPrice: body.minPrice } : {}),
      ...(body.maxPrice != null ? { maxPrice: body.maxPrice } : {}),
    };

    const { selected, rejected } = filterProducts(results.products, criteria);

    // Add selection reasoning to each selected product
    const selectedWithReasoning = selected.map((p, i) => ({
      ...p,
      selectionReasoning: generateSelectionReasoning(p, i + 1, results.products.length),
    }));

    return new Response(
      JSON.stringify({
        products: results.products,
        filtered: selectedWithReasoning,
        rejectedCount: rejected.length,
        total: results.totalResults,
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
