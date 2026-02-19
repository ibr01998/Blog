# GA4 Enhanced Metrics - Implementation Details

## Overview

This document describes the enhanced GA4 integration that provides the Analyst agent with comprehensive user behavior data to make informed content strategy decisions.

---

## Metrics Collected

### 1. Engagement Metrics

**What it is**: Measures how users interact with your content.

**Metrics**:
- `engagedSessions`: Sessions where user spent >10 seconds, had conversion event, or viewed 2+ pages
- `engagementRate`: Percentage of sessions that were engaged
- `avgEngagementTimeSeconds`: Average time users actively engage with content
- `eventCountPerUser`: Average number of events per user

**What Analyst learns**:
- Low engagement rate (<40%) = content not resonating with audience
- High event count = users interacting with CTAs, scrolling, clicking
- Low engagement time = content too long or boring

**Agent implications**:
- Low engagement → Recommend Writer agent use shorter, punchier content
- High bounce + low engagement → Recommend stronger hooks (increase_assertiveness)

---

### 2. Scroll Depth Metrics

**What it is**: Tracks how far users scroll down the page.

**Metrics**:
- `scrollDepth25Count`: Number of times users scrolled to 25%
- `scrollDepth50Count`: Number of times users scrolled to 50%
- `scrollDepth75Count`: Number of times users scrolled to 75%
- `scrollDepth90Count`: Number of times users scrolled to 90%
- `avgScrollDepth`: Weighted average scroll depth across all users
- `totalScrollEvents`: Total number of scroll tracking events

**What Analyst learns**:
- `avgScrollDepth < 50%` = Users abandoning articles early
- `scrollDepth90 low` = Users not reaching CTAs at bottom
- `scrollDepth50 high` but `scrollDepth90 low` = Content loses momentum mid-article

**Agent implications**:
- Low scroll depth → Recommend `lower_wordcount: true` for Writer agent
- High 25% but low 50% → Hook works but body fails to deliver
- High 90% → Current content length is optimal

---

### 3. Per-Article Metrics

**What it is**: Detailed metrics for each blog post.

**Metrics**:
- `views`: Total page views
- `uniqueUsers`: Unique visitors
- `avgSessionDuration`: Time spent on page
- `bounceRate`: Percentage who left without interaction
- `exitRate`: Percentage who left site from this page
- `conversions`: Conversion events (affiliate clicks, signups)
- `engagedSessions`: Sessions with meaningful engagement
- `engagementRate`: Percentage of engaged sessions
- `avgEngagementTime`: Active engagement time

**What Analyst learns**:
- Which article formats perform best
- Which keywords/topics drive traffic
- Which posts convert visitors to customers
- Exit rate patterns (are certain topics dead-ends?)

**Agent implications**:
- Top converting articles → Analyze format, length, CTA placement
- High traffic but low engagement → SEO title clickbait issue
- High exit rate → Content doesn't link to related articles

---

### 4. Traffic Source Analysis

**What it is**: Where users come from.

**Metrics**:
- `source`: google, facebook, direct, etc.
- `medium`: organic, social, referral, etc.
- `campaign`: Campaign name (if tagged)
- `sessions`: Number of sessions from this source
- `users`: Unique users from this source
- `bounceRate`: Bounce rate per source

**What Analyst learns**:
- Organic search = SEO working
- High social traffic = viral potential
- High bounce from specific source = content-audience mismatch

**Agent implications**:
- High organic traffic → Continue current SEO strategy
- Low organic traffic → Recommend more keyword-focused content (money tier)
- High social bounce → Content doesn't match social audience expectations

---

### 5. Device Breakdown

**What it is**: Mobile vs Desktop vs Tablet usage.

**Metrics**:
- `deviceCategory`: mobile, desktop, tablet
- `sessions`: Sessions per device
- `percentage`: Percentage of total traffic
- `bounceRate`: Bounce rate per device

**What Analyst learns**:
- Mobile-first audience needs shorter, scannable content
- Desktop audience can handle longer, detailed articles
- High mobile bounce = poor mobile experience

**Agent implications**:
- High mobile traffic + high mobile bounce → Recommend shorter paragraphs, more headings
- Desktop dominant → Can write longer, more detailed content

---

## Data Flow to Analyst Agent

```
┌─────────────────────────────────────────────────────────────┐
│                    Editorial Cycle Start                     │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      Analyst Agent Run                       │
│                                                              │
│  1. Query Postgres                                           │
│     - Writer performance (CTR, conversion rate)              │
│     - Affiliate link performance                             │
│     - Content strategy metrics                               │
│     - Trend analysis (recent vs older articles)              │
│                                                              │
│  2. Query GA4 API (getAnalyticsSummary)                      │
│     ✓ Overall metrics (users, sessions, pageviews)          │
│     ✓ Engagement metrics (engagement rate, time)            │
│     ✓ Scroll depth (25/50/75/90% breakdown)                 │
│     ✓ Top blog posts (views, conversions, engagement)       │
│     ✓ Traffic sources (organic, social, direct)             │
│     ✓ Device breakdown (mobile, desktop, tablet)            │
│                                                              │
│  3. Query GA4 API (getConversionEvents)                      │
│     ✓ Affiliate click events                                │
│     ✓ Newsletter signup events                              │
│     ✓ Custom conversion events                              │
│                                                              │
│  4. Build comprehensive prompt with ALL data                 │
│     - Includes Postgres metrics                             │
│     - Includes GA4 metrics                                  │
│     - Includes scroll depth analysis                        │
│     - Includes engagement insights                          │
│                                                              │
│  5. Send to LLM (GPT-4o Mini)                               │
│     - Model analyzes all data                               │
│     - Identifies patterns and trends                        │
│     - Makes strategic recommendations                       │
│     - Suggests agent overrides                              │
│                                                              │
│  6. Return AnalystReport                                     │
│     ✓ Recommended content tier                              │
│     ✓ Recommended hook type                                 │
│     ✓ Recommended format type                               │
│     ✓ Performance insights (3-6 specific findings)          │
│     ✓ Suggested agent overrides (if needed)                 │
│     ✓ Best performing strategy                              │
│     ✓ Trend direction                                       │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Strategist Uses Report                    │
│              Generates article briefs based on               │
│              Analyst's data-driven recommendations           │
└─────────────────────────────────────────────────────────────┘
```

---

## Example: How Analyst Uses Scroll Depth

### Scenario 1: Low Scroll Depth (avg 35%)

**GA4 Data**:
- avgScrollDepth: 35%
- scrollDepth50Count: 120 (15% of visitors)
- scrollDepth90Count: 20 (2.5% of visitors)

**Analyst Interpretation**:
"Users are abandoning articles early. Only 15% read past halfway. Current content is too long or fails to maintain interest."

**Recommendations**:
1. Recommend Writer agent override: `lower_wordcount: true`
2. Recommend format: "comparison" (scannable, bullet-point heavy)
3. Recommend hook: "benefit" (immediate value proposition)

**Agent Override Suggestion**:
```json
{
  "agent_id": "writer-agent-id",
  "suggested_overrides": {
    "lower_wordcount": true,
    "increase_assertiveness": false
  },
  "reasoning": "Avg scroll depth 35% indicates users not reading full articles. Shorter content (800 words vs 1200) will improve completion rates."
}
```

---

### Scenario 2: High Scroll Depth (avg 72%)

**GA4 Data**:
- avgScrollDepth: 72%
- scrollDepth50Count: 580 (73% of visitors)
- scrollDepth90Count: 420 (53% of visitors)

**Analyst Interpretation**:
"Users are highly engaged. 73% read past halfway, 53% reach the end. Current content length and format are working well."

**Recommendations**:
1. Continue current strategy (no overrides needed)
2. Recommended format: Current format (likely "guide" or "review")
3. Recommended tier: "authority" (users want depth)

**Agent Override Suggestion**:
```json
{
  "suggested_agent_overrides": []
}
```
(No changes needed - system is performing well)

---

### Scenario 3: Drop-off Mid-Article (50% high, 90% low)

**GA4 Data**:
- avgScrollDepth: 58%
- scrollDepth50Count: 650 (81% of visitors)
- scrollDepth90Count: 180 (22% of visitors)

**Analyst Interpretation**:
"Strong hook gets users to read halfway, but content loses momentum. Possible issues: article structure, lack of subheadings, or boring middle section."

**Recommendations**:
1. Recommend Humanizer agent: `reduce_hype: false` (keep energy high)
2. Recommend Writer agent: Better H2/H3 structure
3. Recommend SEO agent: More engaging subheadings

**Agent Override Suggestion**:
```json
{
  "agent_id": "writer-agent-id",
  "suggested_overrides": {
    "lower_wordcount": false
  },
  "reasoning": "81% read to 50% (good hook), but only 22% reach 90% (content loses steam). Keep length but improve mid-article engagement with better structure."
}
```

---

## Verification Checklist

Before running editorial cycles, verify data is flowing:

### 1. Test GA4 Connection
```bash
GET /api/admin/test-ga4
```

**Expected**:
```json
{
  "success": true,
  "sample_data": {
    "scroll_depth": {
      "avg_scroll_depth": "62.5%",
      "scroll_25": 450,
      "scroll_50": 320,
      "scroll_75": 180,
      "scroll_90": 85
    }
  }
}
```

### 2. Preview Analyst Data
```bash
GET /api/admin/analyst-preview
```

**Expected**:
```json
{
  "data_sources": {
    "ga4": {
      "available": true,
      "engagement": {
        "engagement_rate_percent": "52.3"
      },
      "scroll_depth": {
        "avg_depth_percent": "62.5"
      }
    }
  }
}
```

### 3. Check Analyst Logs

After running a cycle:
1. Go to `/dashboard/agents`
2. Click "Analyst" agent
3. View recent logs
4. Verify `ga4_available: true` in input_summary

---

## Custom Dimension Setup (Required)

Scroll depth tracking requires a custom dimension in GA4:

1. GA4 Admin → Custom definitions
2. Create custom dimension
3. **Dimension name**: `Scroll Depth Percentage`
4. **Scope**: `Event`
5. **Event parameter**: `scroll_depth_pct`

Without this, scroll depth data will show all zeros.

---

## Impact on Agent Decisions

### Writer Agent

**Influenced by**:
- Scroll depth → Article length
- Engagement time → Content density
- Device breakdown → Paragraph length

**Overrides**:
- `lower_wordcount: true` if avgScrollDepth < 50%
- `increase_assertiveness: true` if bounceRate > 70%

### SEO Agent

**Influenced by**:
- Top blog posts → Keyword effectiveness
- Organic traffic → SEO strategy validation
- Conversions per article → CTA effectiveness

**Overrides**:
- `keyword_density_target: 0.012` if organic traffic low

### Humanizer Agent

**Influenced by**:
- Engagement rate → Content readability
- Scroll depth 50-75% range → Mid-article engagement

**Overrides**:
- `reduce_hype: true` if engagementRate < 40%

---

## Troubleshooting

### "Scroll depth shows all zeros"
1. Check custom dimension is configured: `scroll_depth_pct`
2. Wait 24-48 hours for data collection
3. Test locally: scroll to 50%, check GA4 Realtime → Events

### "Engagement rate is 0%"
1. Check GA4 property has data
2. Verify date range (try 30 days instead of 7)
3. Ensure engaged sessions threshold is configured in GA4

### "GA4 data not reaching Analyst"
1. Test connection: `/api/admin/test-ga4`
2. Preview data: `/api/admin/analyst-preview`
3. Check Vercel logs for GA4 API errors
4. Verify all 3 env vars are set correctly

---

**Last Updated**: 2026-02-19
**Author**: Claude Sonnet 4.5
**Status**: Production Ready
