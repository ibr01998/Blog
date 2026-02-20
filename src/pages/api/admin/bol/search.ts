import type { APIRoute } from 'astro';
import { isConfigured, searchProducts } from '../../../../lib/bol/client';
import { filterProducts, DEFAULT_CRITERIA } from '../../../../lib/bol/selection';
import { generateSelectionReasoning } from '../../../../lib/bol/selection';

export const POST: APIRoute = async ({ request }) => {
  if (!isConfigured()) {
    return new Response(
      JSON.stringify({
        error: 'Bol.com API credentials niet geconfigureerd',
        hint: 'Stel BOL_CLIENT_ID, BOL_CLIENT_SECRET en BOL_SITE_ID in als omgevingsvariabelen via het bol.com Partner Programma.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();

    if (!body.keywords && !body.searchTerm) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: keywords or searchTerm' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const results = await searchProducts({
      searchTerm: body.searchTerm || body.keywords,
      countryCode: body.countryCode ?? 'BE',
      categoryId: body.categoryId,
      sortBy: body.sortBy,
      itemCount: body.itemCount ?? 24,
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
