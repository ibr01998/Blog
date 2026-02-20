/**
 * Neon Postgres client for the autonomous agent system.
 * All new tables (agents, articles, agent_logs, affiliate_links,
 * article_metrics, system_config) live here.
 *
 * The existing Astro DB tables (Post, Platform, AnalyticsView, AnalyticsClick)
 * remain in the Astro DB (Turso) and are accessed via 'astro:db'.
 *
 * Uses @neondatabase/serverless HTTP driver — optimized for Vercel serverless functions.
 * Environment variable: DATABASE_URL (auto-injected by Vercel Neon integration)
 * For local dev: run `vercel env pull .env.development.local`
 *
 * IMPORTANT: Never import this file from client-side scripts or edge runtime.
 * Only use in server-rendered Astro files and API routes (Node.js env).
 */

import { neon } from '@neondatabase/serverless';

// Lazy-initialize the Neon SQL client — reads DATABASE_URL from env on first use.
// In Vercel: DATABASE_URL is auto-injected by the Neon Marketplace integration.
// In local dev: copy from `vercel env pull .env.development.local`.
let _sql: ReturnType<typeof neon> | null = null;

function getSql(): ReturnType<typeof neon> {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL ?? (import.meta as any).env?.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Run: vercel env pull .env.development.local'
    );
  }
  _sql = neon(url);
  return _sql;
}

/**
 * Parameterized query helper. Returns typed rows.
 * Uses Neon HTTP driver (no persistent connection — safe for serverless).
 * @example
 *   const rows = await query<{ id: string }>('SELECT id FROM agents WHERE role = $1', ['analyst']);
 */
/**
 * Parameterized query helper. Returns typed rows.
 * Uses neon().query() — the conventional $1/$2 API for @neondatabase/serverless v1+.
 * The tagged-template form (sql`...`) was removed for direct calls in v1.
 * @example
 *   const rows = await query<{ id: string }>('SELECT id FROM agents WHERE role = $1', ['analyst']);
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  const sql = getSql();
  // neon v1+: direct sql(text, params) was removed; use sql.query(text, params) instead.
  const result = await (sql as unknown as { query: (t: string, p?: unknown[]) => Promise<T[]> }).query(text, values);
  return result;
}

/**
 * Sequential query runner — runs multiple queries in order.
 * Note: Neon HTTP mode doesn't support true ACID transactions per request.
 * For true transaction support, use neon Pool (WebSocket) mode.
 * Currently no agent code requires multi-statement transactions.
 */
export async function transaction<T>(
  fn: (q: <R = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<R[]>) => Promise<T>
): Promise<T> {
  return fn(query);
}

// ─── Migration SQL ─────────────────────────────────────────────────────────────

export const MIGRATION_SQL = `
-- Enable pgvector extension for 1536-dimension embeddings (text-embedding-3-small)
CREATE EXTENSION IF NOT EXISTS vector;

-- agents: AI editorial agents with configurable personas and override system
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('analyst','strategist','editor','writer','humanizer','seo')),
  personality_config JSONB NOT NULL DEFAULT '{}',
  behavior_overrides JSONB NOT NULL DEFAULT '{}',
  performance_score FLOAT NOT NULL DEFAULT 0.5,
  article_slots INT NOT NULL DEFAULT 3,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- articles: AI-generated articles pending human review before publishing
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL DEFAULT 'nl',
  writer_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  content_tier TEXT NOT NULL CHECK (content_tier IN ('money','authority','trend')),
  primary_keyword TEXT NOT NULL,
  intent TEXT NOT NULL,
  hook_type TEXT NOT NULL,
  format_type TEXT NOT NULL,
  word_count INT,
  article_markdown TEXT,
  meta_description TEXT,
  meta_title TEXT,
  embedding vector(1536),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','published')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  image_url TEXT,
  human_notes TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- agent_logs: Full reasoning audit trail for every agent action
CREATE TABLE IF NOT EXISTS agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  input_summary JSONB NOT NULL DEFAULT '{}',
  decision_summary JSONB NOT NULL DEFAULT '{}',
  reasoning_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- affiliate_links: Platform affiliate URLs with performance tracking
CREATE TABLE IF NOT EXISTS affiliate_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_name TEXT NOT NULL,
  affiliate_url TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'NL',
  priority_score FLOAT NOT NULL DEFAULT 1.0,
  avg_conversion_rate FLOAT NOT NULL DEFAULT 0.0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- article_metrics: Performance data per article (updated by analytics tracking)
CREATE TABLE IF NOT EXISTS article_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  views INT NOT NULL DEFAULT 0,
  ctr FLOAT NOT NULL DEFAULT 0,
  avg_time_on_page FLOAT NOT NULL DEFAULT 0,
  bounce_rate FLOAT NOT NULL DEFAULT 0,
  affiliate_clicks INT NOT NULL DEFAULT 0,
  conversion_count INT NOT NULL DEFAULT 0,
  revenue FLOAT NOT NULL DEFAULT 0,
  rank_position INT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- system_config: Singleton row (id=1) controlling system-wide kill switches
CREATE TABLE IF NOT EXISTS system_config (
  id INT PRIMARY KEY DEFAULT 1,
  system_paused BOOLEAN NOT NULL DEFAULT false,
  auto_publish_enabled BOOLEAN NOT NULL DEFAULT false,
  max_articles_per_week INT NOT NULL DEFAULT 5,
  enable_multi_agent BOOLEAN NOT NULL DEFAULT true,
  enable_auto_evolution BOOLEAN NOT NULL DEFAULT false
);

-- Seed default system_config if not present (idempotent)
INSERT INTO system_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_review_status ON articles(review_status);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_primary_keyword ON articles(primary_keyword);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_article_id ON agent_logs(article_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_stage ON agent_logs(stage);
CREATE INDEX IF NOT EXISTS idx_article_metrics_article_id ON article_metrics(article_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_country ON affiliate_links(country);

-- content_strategy_metrics: Aggregated performance by content strategy combination
CREATE TABLE IF NOT EXISTS content_strategy_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_tier TEXT NOT NULL,
  hook_type TEXT NOT NULL,
  format_type TEXT NOT NULL,
  article_count INT NOT NULL DEFAULT 0,
  avg_views FLOAT NOT NULL DEFAULT 0,
  avg_ctr FLOAT NOT NULL DEFAULT 0,
  avg_time_on_page FLOAT NOT NULL DEFAULT 0,
  avg_bounce_rate FLOAT NOT NULL DEFAULT 0,
  total_affiliate_clicks INT NOT NULL DEFAULT 0,
  avg_conversion_rate FLOAT NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csm_computed ON content_strategy_metrics(computed_at DESC);

-- Migrations: add columns that may not exist on older deployments (safe to re-run)
ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url TEXT;

-- market_research: Daily external research snapshots (Tavily + LLM extraction)
CREATE TABLE IF NOT EXISTS market_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  research_date DATE NOT NULL,
  search_results JSONB NOT NULL DEFAULT '{}',
  trending_topics JSONB NOT NULL DEFAULT '[]',
  keyword_opportunities JSONB NOT NULL DEFAULT '[]',
  competitor_patterns JSONB NOT NULL DEFAULT '{}',
  recommended_keywords TEXT[] NOT NULL DEFAULT '{}',
  insights_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_market_research_date ON market_research(research_date DESC);

-- Allow researcher role in agents table (fixes CHECK constraint on existing DBs)
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_check;
ALTER TABLE agents ADD CONSTRAINT agents_role_check
  CHECK (role IN ('analyst','strategist','editor','writer','humanizer','seo','researcher'));

-- Add enable_research_agent toggle to system_config
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS enable_research_agent BOOLEAN NOT NULL DEFAULT true;

-- amazon_products: Products fetched from Creators API or entered manually
CREATE TABLE IF NOT EXISTS amazon_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  current_price FLOAT NOT NULL DEFAULT 0,
  list_price FLOAT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  rating FLOAT NOT NULL DEFAULT 0,
  review_count INT NOT NULL DEFAULT 0,
  availability TEXT NOT NULL DEFAULT 'Unknown',
  prime_eligible BOOLEAN NOT NULL DEFAULT false,
  affiliate_url TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  features JSONB NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  best_seller_rank INT,
  raw_api_response JSONB NOT NULL DEFAULT '{}',
  selection_reasoning TEXT NOT NULL DEFAULT '',
  price_history JSONB NOT NULL DEFAULT '[]',
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_amazon_products_asin ON amazon_products(asin);
CREATE INDEX IF NOT EXISTS idx_amazon_products_category ON amazon_products(category);
CREATE INDEX IF NOT EXISTS idx_amazon_products_article ON amazon_products(article_id);

-- amazon_performance: Affiliate click and conversion tracking for Amazon products
CREATE TABLE IF NOT EXISTS amazon_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES amazon_products(id) ON DELETE CASCADE,
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  clicks INT NOT NULL DEFAULT 0,
  conversions INT NOT NULL DEFAULT 0,
  revenue FLOAT NOT NULL DEFAULT 0,
  epc FLOAT NOT NULL DEFAULT 0,
  conversion_rate FLOAT NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_amazon_perf_product ON amazon_performance(product_id);
CREATE INDEX IF NOT EXISTS idx_amazon_perf_article ON amazon_performance(article_id);
`;

// ─── Seed Data ────────────────────────────────────────────────────────────────

export const SEED_AGENTS = [
  {
    name: 'Markt-Analist Pro',
    role: 'analyst',
    personality_config: {
      tone: 'analytical',
      writing_style: 'data-driven',
      preferred_formats: ['comparison', 'fee'],
    },
    behavior_overrides: {
      reduce_hype: true,
    },
    performance_score: 0.5,
    article_slots: 1,
  },
  {
    name: 'Content Strateeg',
    role: 'strategist',
    personality_config: {
      tone: 'strategic',
      writing_style: 'concise',
      preferred_formats: ['comparison', 'review', 'bonus'],
    },
    behavior_overrides: {},
    performance_score: 0.5,
    article_slots: 1,
  },
  {
    name: 'Redacteur Chef',
    role: 'editor',
    personality_config: {
      tone: 'editorial',
      writing_style: 'critical',
      preferred_formats: ['comparison', 'review'],
    },
    behavior_overrides: {},
    performance_score: 0.5,
    article_slots: 1,
  },
  {
    name: 'Schrijver Alpha',
    role: 'writer',
    personality_config: {
      tone: 'confident',
      writing_style: 'conversion-focused',
      preferred_formats: ['comparison', 'review', 'bonus'],
    },
    behavior_overrides: {
      reduce_hype: true,
    },
    performance_score: 0.5,
    article_slots: 3,
  },
  {
    name: 'Humanizer',
    role: 'humanizer',
    personality_config: {
      tone: 'natural',
      writing_style: 'conversational',
      preferred_formats: [],
    },
    behavior_overrides: {},
    performance_score: 0.5,
    article_slots: 1,
  },
  {
    name: 'SEO Optimizer',
    role: 'seo',
    personality_config: {
      tone: 'technical',
      writing_style: 'precise',
      preferred_formats: [],
    },
    behavior_overrides: {
      keyword_density_target: 0.011,
    },
    performance_score: 0.5,
    article_slots: 1,
  },
  {
    name: 'Markt-Onderzoeker',
    role: 'researcher',
    personality_config: {
      tone: 'analytical',
      writing_style: 'data-driven',
      preferred_formats: [],
    },
    behavior_overrides: {},
    performance_score: 0.5,
    article_slots: 0,
  },
];

export const SEED_AFFILIATE_LINKS = [
  { platform_name: 'BitMEX', affiliate_url: 'https://www.bitmex.com/app/register/PeDh7o', country: 'NL', priority_score: 3.0, avg_conversion_rate: 0.04 },
  { platform_name: 'BitMEX', affiliate_url: 'https://www.bitmex.com/app/register/PeDh7o', country: 'BE', priority_score: 3.0, avg_conversion_rate: 0.04 },
  { platform_name: 'Bybit', affiliate_url: 'https://www.bybit.eu/invite?ref=BW3PYWV', country: 'NL', priority_score: 4.0, avg_conversion_rate: 0.06 },
  { platform_name: 'Bybit', affiliate_url: 'https://www.bybit.eu/invite?ref=BW3PYWV', country: 'BE', priority_score: 4.0, avg_conversion_rate: 0.06 },
  { platform_name: 'Binance', affiliate_url: 'https://www.binance.com/referral/earn-together/refer2earn-usdc/claim?ref=GRO_28502_9B9D7', country: 'NL', priority_score: 3.5, avg_conversion_rate: 0.05 },
  { platform_name: 'Binance', affiliate_url: 'https://www.binance.com/referral/earn-together/refer2earn-usdc/claim?ref=GRO_28502_9B9D7', country: 'BE', priority_score: 3.5, avg_conversion_rate: 0.05 },
  { platform_name: 'Kraken', affiliate_url: 'https://invite.kraken.com/JDNW/e6a2xq6x', country: 'NL', priority_score: 3.8, avg_conversion_rate: 0.055 },
  { platform_name: 'Kraken', affiliate_url: 'https://invite.kraken.com/JDNW/e6a2xq6x', country: 'BE', priority_score: 3.8, avg_conversion_rate: 0.055 },
];
