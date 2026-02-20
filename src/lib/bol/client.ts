/**
 * Bol.com Marketing Catalog API Client
 * OAuth 2.0 Client Credentials flow via Basic Auth header.
 *
 * Token endpoint: https://login.bol.com/token?grant_type=client_credentials
 * API base: https://api.bol.com/marketing/catalog/v1/
 *
 * Environment variables:
 *   BOL_CLIENT_ID       - Client ID from bol.com Partner → API toegang
 *   BOL_CLIENT_SECRET   - Client Secret from same
 *   BOL_SITE_ID         - Registered website Site ID for affiliate links
 */

import type {
  BolProduct,
  BolSearchParams,
  BolSearchResult,
  OAuthTokenResponse,
} from './types';

// ─── Configuration ──────────────────────────────────────────────────────────────

function getEnv(key: string): string | undefined {
  return process.env[key] ?? (import.meta as any).env?.[key];
}

function getConfig() {
  return {
    clientId: getEnv('BOL_CLIENT_ID') ?? '',
    clientSecret: getEnv('BOL_CLIENT_SECRET') ?? '',
    siteId: getEnv('BOL_SITE_ID') ?? '',
  };
}

/** Check whether bol.com API credentials are configured. */
export function isConfigured(): boolean {
  const cfg = getConfig();
  return !!(cfg.clientId && cfg.clientSecret && cfg.siteId);
}

// ─── OAuth 2.0 Token Management ─────────────────────────────────────────────────

const TOKEN_ENDPOINT = 'https://login.bol.com/token?grant_type=client_credentials';
const TOKEN_BUFFER_MS = 30_000; // 30s buffer — token only lasts 299s

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const cfg = getConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      'Bol.com API credentials not configured. ' +
      'Set BOL_CLIENT_ID and BOL_CLIENT_SECRET environment variables.'
    );
  }

  const basicAuth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bol.com OAuth token request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OAuthTokenResponse;
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000) - TOKEN_BUFFER_MS;

  return cachedToken;
}

// ─── API Request Helper ─────────────────────────────────────────────────────────

const API_BASE = 'https://api.bol.com/marketing/catalog/v1';

async function apiRequest<T>(
  path: string,
  params: Record<string, string> = {},
  retries = 3
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const token = await getAccessToken();

      const res = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Accept-Language': 'nl',
        },
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Bol.com API ${path} failed (${res.status}): ${text}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      if (attempt < retries - 1 && err instanceof TypeError) {
        // Network error — retry
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Bol.com API ${path} failed after ${retries} retries`);
}

// ─── Affiliate URL Builder ──────────────────────────────────────────────────────

function buildAffiliateUrl(productUrl: string): string {
  const cfg = getConfig();
  return `https://partner.bol.com/click/click?p=1&t=url&s=${cfg.siteId}&f=TXL&url=${encodeURIComponent(productUrl)}`;
}

// ─── Response Parsing ───────────────────────────────────────────────────────────

function parseProduct(item: any, countryCode: 'BE' | 'NL' = 'BE'): BolProduct {
  const offer = item.offerData ?? item.offer ?? {};
  const price = offer.bolPrice ?? offer.price ?? 0;
  const listPrice = offer.listPrice ?? null;
  const images = item.images ?? [];

  return {
    ean: item.ean ?? '',
    bolProductId: String(item.id ?? item.bolProductId ?? ''),
    title: item.title ?? '',
    brand: item.specsTag ?? item.brand ?? '',
    category: item.parentCategoryPaths?.[0]?.parentCategories?.slice(-1)?.[0]?.name ?? '',
    price,
    currency: 'EUR',
    listPrice,
    discountPercent: listPrice && listPrice > price
      ? Math.round(((listPrice - price) / listPrice) * 100)
      : null,
    rating: item.rating ?? 0,
    reviewCount: item.shortReviewCount ?? 0,
    availability: offer.availabilityDescription ?? 'Unknown',
    deliveryLabel: offer.deliveryLabel ?? '',
    affiliateUrl: item.urls?.[0]?.value
      ? buildAffiliateUrl(item.urls[0].value)
      : '',
    imageUrl: images[0]?.url ?? '',
    imageVariants: images.map((img: any) => img.url).filter(Boolean),
    features: (item.specsHighlights ?? []).map((s: any) => s.value ?? s).filter(Boolean),
    description: item.shortDescription ?? '',
    offerCondition: offer.condition ?? 'NEW',
    countryCode,
    rawApiResponse: item,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Search bol.com products by search term.
 * Requires configured API credentials.
 */
export async function searchProducts(params: BolSearchParams): Promise<BolSearchResult> {
  const countryCode = params.countryCode ?? 'BE';
  const pageSize = Math.min(params.itemCount ?? 24, 50);

  const queryParams: Record<string, string> = {
    'search-term': params.searchTerm,
    'country-code': countryCode,
    'include-image': 'true',
    'include-offer': 'true',
    'include-rating': 'true',
    'page-size': String(pageSize),
  };

  if (params.sortBy) queryParams['sort'] = params.sortBy;
  if (params.categoryId) queryParams['category-id'] = params.categoryId;

  const data = await apiRequest<any>('/products/search', queryParams);

  const products = (data.products ?? []).map((item: any) => parseProduct(item, countryCode));

  return {
    products,
    totalResults: data.totalResultSize ?? products.length,
  };
}

/**
 * Get full product details by EAN.
 * Requires configured API credentials.
 */
export async function getProduct(ean: string, countryCode: 'BE' | 'NL' = 'BE'): Promise<BolProduct | null> {
  try {
    const data = await apiRequest<any>(`/products/${ean}`, {
      'country-code': countryCode,
      'include-specifications': 'true',
      'include-image': 'true',
      'include-offer': 'true',
      'include-rating': 'true',
    });

    return parseProduct(data, countryCode);
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) {
      return null;
    }
    throw err;
  }
}

/**
 * Refresh a single product's data from the API.
 * Returns null if the product is no longer available.
 */
export async function refreshProduct(ean: string, countryCode: 'BE' | 'NL' = 'BE'): Promise<BolProduct | null> {
  return getProduct(ean, countryCode);
}
