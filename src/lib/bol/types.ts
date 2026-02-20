/**
 * Bol.com Partner Programma — TypeScript Interfaces
 * Used across the Marketing Catalog API client, product selection,
 * article generation, dashboard, and API routes.
 */

// ─── Product Types ──────────────────────────────────────────────────────────────

export interface BolProduct {
  ean: string;
  bolProductId: string;
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
  deliveryLabel: string;
  affiliateUrl: string;
  imageUrl: string;
  imageVariants: string[];
  features: string[];
  description: string;
  offerCondition: string;
  countryCode: 'BE' | 'NL';
  rawApiResponse: Record<string, unknown>;
  fetchedAt: string;
}

export interface BolProductRow {
  id: string;
  ean: string;
  bol_product_id: string;
  title: string;
  brand: string;
  category: string;
  current_price: number;
  list_price: number | null;
  currency: string;
  rating: number;
  review_count: number;
  availability: string;
  delivery_label: string;
  affiliate_url: string;
  image_url: string;
  features: string[] | string;
  description: string;
  offer_condition: string;
  country_code: string;
  raw_api_response: Record<string, unknown> | string;
  selection_reasoning: string;
  price_history: { price: number; date: string }[] | string;
  article_id: string | null;
  is_available: boolean;
  source: 'api' | 'manual';
  created_at: string;
  updated_at: string;
}

export interface BolPerformanceRow {
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

export interface BolSearchParams {
  searchTerm: string;
  countryCode?: 'BE' | 'NL';
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  minReviews?: number;
  sortBy?: 'RELEVANCE' | 'POPULARITY' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING';
  itemCount?: number;
}

export interface BolSearchResult {
  products: BolProduct[];
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
  selected: BolProduct[];
  rejected: { product: BolProduct; reason: string }[];
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
  ean?: string;
  title: string;
  brand: string;
  category: string;
  price: number;
  currency?: string;
  listPrice?: number;
  rating?: number;
  reviewCount?: number;
  availability?: string;
  deliveryLabel?: string;
  affiliateUrl?: string;
  imageUrl?: string;
  features?: string[];
  description?: string;
  countryCode?: 'BE' | 'NL';
}

// ─── Bol.com API Auth Types ─────────────────────────────────────────────────────

export interface BolAPIConfig {
  clientId: string;
  clientSecret: string;
  siteId: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}
