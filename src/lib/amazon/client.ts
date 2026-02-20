/**
 * Amazon Creators API Client
 * Replaces PA-API 5.0 (deprecated April 30, 2026) with OAuth 2.0 authentication.
 *
 * Authentication: OAuth 2.0 client-credentials flow
 * Token endpoint: https://api.amazon.com/auth/o2/token
 * Credentials: Created in Associates Central → Creators API → Create App
 *
 * Environment variables:
 *   AMAZON_CREDENTIAL_ID      - Credential ID from Creators API
 *   AMAZON_CREDENTIAL_SECRET   - Credential Secret from Creators API
 *   AMAZON_PARTNER_TAG         - Associates tracking tag (e.g. shortnews0b-21)
 *   AMAZON_MARKETPLACE         - Marketplace host (default: www.amazon.nl)
 */

import type {
  AmazonProduct,
  AmazonSearchParams,
  AmazonSearchResult,
  OAuthTokenResponse,
} from './types';

// ─── Configuration ──────────────────────────────────────────────────────────────

function getEnv(key: string): string | undefined {
  return process.env[key] ?? (import.meta as any).env?.[key];
}

function getConfig() {
  return {
    credentialId: getEnv('AMAZON_CREDENTIAL_ID') ?? '',
    credentialSecret: getEnv('AMAZON_CREDENTIAL_SECRET') ?? '',
    partnerTag: getEnv('AMAZON_PARTNER_TAG') ?? '',
    marketplace: getEnv('AMAZON_MARKETPLACE') ?? 'www.amazon.nl',
  };
}

/** Check whether Amazon Creators API credentials are configured. */
export function isConfigured(): boolean {
  const cfg = getConfig();
  return !!(cfg.credentialId && cfg.credentialSecret && cfg.partnerTag);
}

// ─── OAuth 2.0 Token Management ─────────────────────────────────────────────────

const TOKEN_ENDPOINT = 'https://api.amazon.com/auth/o2/token';
const TOKEN_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const cfg = getConfig();
  if (!cfg.credentialId || !cfg.credentialSecret) {
    throw new Error(
      'Amazon Creators API credentials not configured. ' +
      'Set AMAZON_CREDENTIAL_ID and AMAZON_CREDENTIAL_SECRET environment variables.'
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.credentialId,
    client_secret: cfg.credentialSecret,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OAuthTokenResponse;
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000) - TOKEN_BUFFER_MS;

  return cachedToken;
}

// ─── API Request Helper ─────────────────────────────────────────────────────────

// Marketplace → API host mapping
const MARKETPLACE_HOSTS: Record<string, string> = {
  'www.amazon.nl': 'webservices.amazon.nl',
  'www.amazon.de': 'webservices.amazon.de',
  'www.amazon.fr': 'webservices.amazon.fr',
  'www.amazon.com': 'webservices.amazon.com',
  'www.amazon.co.uk': 'webservices.amazon.co.uk',
};

async function apiRequest<T>(
  operation: string,
  payload: Record<string, unknown>,
  retries = 3
): Promise<T> {
  const cfg = getConfig();
  const apiHost = MARKETPLACE_HOSTS[cfg.marketplace] ?? 'webservices.amazon.nl';
  const path = `/paapi5/${operation.toLowerCase()}`;
  const url = `https://${apiHost}${path}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const token = await getAccessToken();

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${token}`,
          'X-Amz-Target': `com.amazon.paapi5.v1.ProductAdvertisingAPIv1.${operation}`,
        },
        body: JSON.stringify(payload),
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
        throw new Error(`Creators API ${operation} failed (${res.status}): ${text}`);
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

  throw new Error(`Creators API ${operation} failed after ${retries} retries`);
}

// ─── PA-API Resources ───────────────────────────────────────────────────────────

const SEARCH_RESOURCES = [
  'ItemInfo.Title',
  'ItemInfo.ByLineInfo',
  'ItemInfo.ContentInfo',
  'ItemInfo.Features',
  'ItemInfo.ManufactureInfo',
  'ItemInfo.ProductInfo',
  'ItemInfo.TechnicalInfo',
  'Offers.Listings.Price',
  'Offers.Listings.Availability.Type',
  'Offers.Listings.DeliveryInfo.IsPrimeEligible',
  'Images.Primary.Large',
  'Images.Variants.Large',
  'BrowseNodeInfo.BrowseNodes',
];

// ─── Response Parsing ───────────────────────────────────────────────────────────

function parseProduct(item: any): AmazonProduct {
  const cfg = getConfig();
  const listing = item.Offers?.Listings?.[0] ?? {};
  const price = listing.Price?.Amount ?? 0;
  const listPrice = listing.Price?.SavingBasis?.Amount ?? null;

  return {
    asin: item.ASIN ?? '',
    title: item.ItemInfo?.Title?.DisplayValue ?? '',
    brand: item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ?? '',
    category: item.BrowseNodeInfo?.BrowseNodes?.[0]?.DisplayName ?? '',
    price,
    currency: listing.Price?.Currency ?? 'EUR',
    listPrice,
    discountPercent: listPrice ? Math.round(((listPrice - price) / listPrice) * 100) : null,
    rating: 0, // Note: Creators API may not return ratings directly
    reviewCount: 0,
    availability: listing.Availability?.Type ?? 'Unknown',
    primeEligible: listing.DeliveryInfo?.IsPrimeEligible ?? false,
    affiliateUrl: item.DetailPageURL ?? `https://${cfg.marketplace}/dp/${item.ASIN}?tag=${cfg.partnerTag}`,
    imageUrl: item.Images?.Primary?.Large?.URL ?? '',
    imageVariants: (item.Images?.Variants ?? []).map((v: any) => v.Large?.URL).filter(Boolean),
    features: (item.ItemInfo?.Features?.DisplayValues ?? []),
    description: item.ItemInfo?.ContentInfo?.ContentLanguages?.DisplayValues?.[0] ?? '',
    bestSellerRank: item.BrowseNodeInfo?.BrowseNodes?.[0]?.SalesRank ?? null,
    browseNodes: (item.BrowseNodeInfo?.BrowseNodes ?? []).map((n: any) => ({
      id: n.Id ?? '',
      name: n.DisplayName ?? '',
    })),
    rawApiResponse: item,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Search Amazon products by keywords.
 * Requires configured Creators API credentials.
 */
export async function searchItems(params: AmazonSearchParams): Promise<AmazonSearchResult> {
  const cfg = getConfig();

  const payload: Record<string, unknown> = {
    partnerTag: cfg.partnerTag,
    partnerType: 'Associates',
    marketplace: cfg.marketplace,
    keywords: params.keywords,
    resources: SEARCH_RESOURCES,
    itemCount: Math.min(params.itemCount ?? 10, 10),
  };

  if (params.category) payload.searchIndex = params.category;
  if (params.minPrice != null) payload.minPrice = Math.round(params.minPrice * 100);
  if (params.maxPrice != null) payload.maxPrice = Math.round(params.maxPrice * 100);
  if (params.sortBy) payload.sortBy = params.sortBy;

  const data = await apiRequest<any>('SearchItems', payload);

  const products = (data.SearchResult?.Items ?? []).map(parseProduct);

  return {
    products,
    totalResults: data.SearchResult?.TotalResultCount ?? products.length,
  };
}

/**
 * Get full product details by ASIN(s).
 * Requires configured Creators API credentials.
 */
export async function getItems(asins: string[]): Promise<AmazonProduct[]> {
  const cfg = getConfig();

  const payload = {
    partnerTag: cfg.partnerTag,
    partnerType: 'Associates',
    marketplace: cfg.marketplace,
    itemIds: asins.slice(0, 10),
    resources: SEARCH_RESOURCES,
  };

  const data = await apiRequest<any>('GetItems', payload);

  return (data.ItemsResult?.Items ?? []).map(parseProduct);
}

/**
 * Refresh a single product's data from the API.
 * Returns null if the product is no longer available.
 */
export async function refreshProduct(asin: string): Promise<AmazonProduct | null> {
  const products = await getItems([asin]);
  return products[0] ?? null;
}
