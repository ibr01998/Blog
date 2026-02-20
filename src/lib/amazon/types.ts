/**
 * Amazon Associates System — TypeScript Interfaces
 * Used across the Creators API client, product selection, article generation,
 * dashboard, and API routes.
 */

// ─── Product Types ──────────────────────────────────────────────────────────────

export interface AmazonProduct {
  asin: string;
  title: string;
  brand: string;
  category: string;
  price: number;
  currency: string;
  listPrice: number | null;
  discountPercent: number | null;
  rating: number;
  reviewCount: number;
  availability: string;
  primeEligible: boolean;
  affiliateUrl: string;
  imageUrl: string;
  imageVariants: string[];
  features: string[];
  description: string;
  bestSellerRank: number | null;
  browseNodes: { id: string; name: string }[];
  rawApiResponse: Record<string, unknown>;
  fetchedAt: string;
}

export interface AmazonProductRow {
  id: string;
  asin: string;
  title: string;
  brand: string;
  category: string;
  current_price: number;
  list_price: number | null;
  currency: string;
  rating: number;
  review_count: number;
  availability: string;
  prime_eligible: boolean;
  affiliate_url: string;
  image_url: string;
  features: string[] | string;
  description: string;
  best_seller_rank: number | null;
  raw_api_response: Record<string, unknown> | string;
  selection_reasoning: string;
  price_history: { price: number; date: string }[] | string;
  article_id: string | null;
  is_available: boolean;
  source: 'api' | 'manual';
  created_at: string;
  updated_at: string;
}

export interface AmazonPerformanceRow {
  id: string;
  product_id: string;
  article_id: string | null;
  clicks: number;
  conversions: number;
  revenue: number;
  epc: number;
  conversion_rate: number;
  recorded_at: string;
}

// ─── Search Types ───────────────────────────────────────────────────────────────

export interface AmazonSearchParams {
  keywords: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  minReviews?: number;
  sortBy?: string;
  itemCount?: number;
}

export interface AmazonSearchResult {
  products: AmazonProduct[];
  totalResults: number;
}

// ─── Selection Types ────────────────────────────────────────────────────────────

export interface SelectionCriteria {
  minRating: number;
  minReviews: number;
  minPrice: number;
  maxPrice: number;
  requireInStock: boolean;
}

export interface SelectionResult {
  selected: AmazonProduct[];
  rejected: { product: AmazonProduct; reason: string }[];
}

// ─── Article Generation Types ───────────────────────────────────────────────────

export interface GeneratedArticle {
  title: string;
  slug: string;
  metaDescription: string;
  metaTitle: string;
  articleMarkdown: string;
  wordCount: number;
  primaryKeyword: string;
  heroImage: string;
  language: 'nl' | 'en';
}

export interface GenerateArticleParams {
  productIds: string[];
  language?: 'nl' | 'en';
  autoPublish?: boolean;
}

// ─── Manual Product Entry ───────────────────────────────────────────────────────

export interface ManualProductInput {
  asin?: string;
  title: string;
  brand: string;
  category: string;
  price: number;
  currency?: string;
  listPrice?: number;
  rating?: number;
  reviewCount?: number;
  availability?: string;
  affiliateUrl?: string;
  imageUrl?: string;
  features?: string[];
  description?: string;
}

// ─── Creators API Auth Types ────────────────────────────────────────────────────

export interface CreatorsAPIConfig {
  credentialId: string;
  credentialSecret: string;
  partnerTag: string;
  marketplace: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}
