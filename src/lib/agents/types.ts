/**
 * Shared TypeScript interfaces for the autonomous editorial agent system.
 * All inter-agent data contracts are defined here.
 * Every agent file imports from this module.
 */

// ─── Primitive Types ──────────────────────────────────────────────────────────

export type AgentRole =
  | 'analyst'
  | 'strategist'
  | 'editor'
  | 'writer'
  | 'humanizer'
  | 'seo'
  | 'researcher';

export type ContentTier = 'money' | 'authority' | 'trend';
export type HookType = 'fear' | 'curiosity' | 'authority' | 'benefit' | 'story';
export type FormatType = 'comparison' | 'review' | 'bonus' | 'trust' | 'fee' | 'guide';
export type ArticleStatus = 'draft' | 'approved' | 'published';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

// ─── Agent Configuration ──────────────────────────────────────────────────────

export interface BehaviorOverrides {
  increase_assertiveness?: boolean;
  reduce_hype?: boolean;
  lower_wordcount?: boolean;
  avoid_platform?: string[];           // e.g. ['binance', 'bybit']
  force_tone?: string;                 // e.g. 'professional' | 'casual'
  max_affiliate_links?: number;
  keyword_density_target?: number;     // e.g. 0.011 for 1.1%
  [key: string]: unknown;              // extensible for future overrides
}

export interface PersonalityConfig {
  tone: string;
  writing_style: string;
  preferred_formats: FormatType[];
  signature_phrases?: string[];
  avoid_phrases?: string[];
  [key: string]: unknown;
}

export interface AgentRecord {
  id: string;
  name: string;
  role: AgentRole;
  personality_config: PersonalityConfig;
  behavior_overrides: BehaviorOverrides;
  performance_score: number;
  article_slots: number;
  is_active: boolean;
  created_at: string;
}

// ─── Analyst Outputs ──────────────────────────────────────────────────────────

export interface WriterPerformance {
  writer_id: string;
  writer_name: string;
  avg_ctr: number;
  avg_time_on_page: number;
  avg_conversion_rate: number;
  total_articles: number;
  best_tier: ContentTier;
}

export interface AffiliateLinkPerformance {
  platform_name: string;
  avg_conversion_rate: number;
  avg_ctr: number;
  total_clicks: number;
  priority_score: number;
}

export interface AgentOverrideSuggestion {
  agent_id: string;
  suggested_overrides: Partial<BehaviorOverrides>;
  reasoning: string;
}

export interface ContentStrategyPerformance {
  content_tier: ContentTier;
  hook_type: HookType;
  format_type: FormatType;
  article_count: number;
  avg_views: number;
  avg_ctr: number;
  avg_time_on_page: number;
  avg_bounce_rate: number;
  total_affiliate_clicks: number;
  avg_conversion_rate: number;
}

export interface AnalystReport {
  generated_at: string;                   // ISO timestamp
  period_days: number;
  top_writers: WriterPerformance[];
  weak_writers: WriterPerformance[];
  best_affiliate: AffiliateLinkPerformance | null;
  worst_affiliate: AffiliateLinkPerformance | null;
  recommended_content_tier: ContentTier;
  recommended_hook_type: HookType;
  recommended_format_type: FormatType;
  performance_insights: string[];         // human-readable reasoning bullets
  suggested_agent_overrides: AgentOverrideSuggestion[];
  strategy_performance: ContentStrategyPerformance[];
  trend_direction: 'improving' | 'stable' | 'declining';
  best_performing_strategy?: {
    content_tier: ContentTier;
    hook_type: HookType;
    format_type: FormatType;
    reason: string;
  };
}

// ─── Strategist Outputs ───────────────────────────────────────────────────────

export interface ArticleBrief {
  brief_id: string;                       // ephemeral UUID, not persisted alone
  primary_keyword: string;
  title_suggestion: string;
  content_tier: ContentTier;
  intent: string;                         // maps to ArticleIntent from templates.ts
  hook_type: HookType;
  format_type: FormatType;
  target_word_count: number;
  target_platforms: string[];             // platform slugs to feature
  affiliate_focus: string;                // which affiliate to prioritize
  reasoning: string;                      // why this brief was generated
}

// ─── Editor Outputs ───────────────────────────────────────────────────────────

export interface ArticleAssignment {
  assignment_id: string;
  brief: ArticleBrief;
  writer_id: string;
  writer_role: AgentRole;
  writer_name: string;
  assigned_at: string;                    // ISO timestamp
  cooldown_passed: boolean;
  similarity_score: number;              // cosine distance from closest existing article
  editor_reasoning: string;
}

// ─── Writer Outputs ───────────────────────────────────────────────────────────

export interface InternalLink {
  anchor: string;
  href: string;
}

export interface CtaBlock {
  position: 'intro' | 'mid' | 'conclusion';
  platform: string;
  anchor: string;
}

export interface ArticleDraft {
  assignment_id: string;
  title: string;
  slug: string;
  meta_description: string;
  article_markdown: string;               // full markdown including all headings
  word_count: number;
  primary_keyword: string;
  internal_links: InternalLink[];
  cta_blocks: CtaBlock[];
  estimated_reading_time_minutes: number;
}

// ─── Humanizer Outputs ────────────────────────────────────────────────────────

export interface ArticleHumanized extends ArticleDraft {
  humanization_changes: string[];         // list of changes applied
}

// ─── SEO Agent Outputs ────────────────────────────────────────────────────────

export interface ArticleOptimized extends ArticleHumanized {
  seo_changes: string[];
  keyword_density: number;                // actual achieved density (0-1)
  faq_schema_added: boolean;
  meta_title: string;                     // may differ from article title
}

// ─── Orchestrator Outputs ─────────────────────────────────────────────────────

export interface CycleSummary {
  cycle_id: string;
  started_at: string;
  completed_at: string;
  analyst_report: AnalystReport;
  briefs_generated: number;
  assignments_made: number;
  articles_produced: number;
  articles_skipped_cooldown: number;
  articles_skipped_similarity: number;
  article_ids: string[];
  error?: string;
}

// ─── Research Agent Outputs ───────────────────────────────────────────────────

export interface MarketResearchRow {
  id: string;
  research_date: string;
  search_results: Record<string, unknown>;
  trending_topics: { keyword: string; trend_score: number; reason: string }[];
  keyword_opportunities: {
    keyword: string;
    content_gap: boolean;
    suggested_angle: string;
    suggested_format: FormatType;
    suggested_hook: HookType;
    estimated_competition?: 'low' | 'medium' | 'high';
  }[];
  competitor_patterns: {
    common_title_patterns: string[];
    popular_formats: string[];
    avg_article_approach: string;
    missing_angles?: string[];
    high_performing_titles?: string[];
  };
  recommended_keywords: string[];
  insights_summary: string;
  created_at: string;
}
