/**
 * Google Analytics 4 Data API Integration
 *
 * Fetches real-time and historical data from GA4 for the Analyst agent.
 * Uses Google Analytics Data API v1 with service account authentication.
 *
 * Required Environment Variables:
 * - GA4_PROPERTY_ID: GA4 Property ID (format: "properties/123456789")
 * - GA4_SERVICE_ACCOUNT_EMAIL: Service account email
 * - GA4_PRIVATE_KEY: Service account private key (base64 encoded)
 *
 * Setup Guide:
 * 1. Create a service account in Google Cloud Console
 * 2. Enable Google Analytics Data API
 * 3. Add service account email to GA4 property with "Viewer" role
 * 4. Download JSON key, extract email and private_key
 * 5. Base64 encode the private_key: echo -n "-----BEGIN..." | base64
 * 6. Add env vars to Vercel
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';

// ─── Types ───────────────────────────────────────────────────────────────────

export type GAPageMetrics = {
  path: string;
  title: string;
  views: number;
  uniqueUsers: number;
  avgSessionDuration: number;
  bounceRate: number;
  conversions: number;
  eventCount: number;
  engagedSessions: number;
  engagementRate: number;
  avgEngagementTime: number;
  exitRate: number;
  scrollDepth25: number;
  scrollDepth50: number;
  scrollDepth75: number;
  scrollDepth90: number;
};

export type GATrafficSource = {
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  users: number;
  bounceRate: number;
};

export type GADeviceCategory = {
  deviceCategory: string;
  sessions: number;
  users: number;
  bounceRate: number;
};

export type GAEventMetrics = {
  eventName: string;
  eventCount: number;
  uniqueUsers: number;
};

export type GAEngagementMetrics = {
  engagedSessions: number;
  engagementRate: number;
  avgEngagementTimeSeconds: number;
  eventCountPerUser: number;
};

export type GAScrollDepthMetrics = {
  scrollDepth25Count: number;
  scrollDepth50Count: number;
  scrollDepth75Count: number;
  scrollDepth90Count: number;
  totalScrollEvents: number;
  avgScrollDepth: number;
};

export type GAAnalyticsSummary = {
  // Overall site metrics
  totalUsers: number;
  totalSessions: number;
  totalPageviews: number;
  avgSessionDuration: number;
  overallBounceRate: number;
  totalConversions: number;

  // Engagement metrics
  engagement: GAEngagementMetrics;

  // Scroll depth metrics
  scrollDepth: GAScrollDepthMetrics;

  // Content performance
  topPages: GAPageMetrics[];
  blogPostPerformance: GAPageMetrics[];

  // Traffic sources
  trafficSources: GATrafficSource[];

  // Device breakdown
  deviceCategories: GADeviceCategory[];

  // Events
  topEvents: GAEventMetrics[];

  // Date range
  startDate: string;
  endDate: string;
};

// ─── Client Initialization ───────────────────────────────────────────────────

let analyticsClient: BetaAnalyticsDataClient | null = null;

function getAnalyticsClient(): BetaAnalyticsDataClient | null {
  if (analyticsClient) return analyticsClient;

  const propertyId = (import.meta as any).env?.GA4_PROPERTY_ID ?? process.env.GA4_PROPERTY_ID;
  const email = (import.meta as any).env?.GA4_SERVICE_ACCOUNT_EMAIL ?? process.env.GA4_SERVICE_ACCOUNT_EMAIL;
  const keyBase64 = (import.meta as any).env?.GA4_PRIVATE_KEY ?? process.env.GA4_PRIVATE_KEY;

  if (!propertyId || !email || !keyBase64) {
    console.warn('[GA4] Missing credentials. Set GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_EMAIL, GA4_PRIVATE_KEY env vars.');
    return null;
  }

  try {
    // Decode base64 private key
    const privateKey = Buffer.from(keyBase64, 'base64').toString('utf-8');

    analyticsClient = new BetaAnalyticsDataClient({
      credentials: {
        client_email: email,
        private_key: privateKey,
      },
      projectId: propertyId.split('/')[1], // Extract project ID from property ID
    });

    return analyticsClient;
  } catch (error) {
    console.error('[GA4] Failed to initialize client:', error);
    return null;
  }
}

// ─── Data Fetching Functions ─────────────────────────────────────────────────

/**
 * Fetch comprehensive analytics summary for the given date range.
 * Default: last 30 days.
 */
export async function getAnalyticsSummary(
  daysBack = 30
): Promise<GAAnalyticsSummary | null> {
  const client = getAnalyticsClient();
  if (!client) return null;

  const propertyId = (import.meta as any).env?.GA4_PROPERTY_ID ?? process.env.GA4_PROPERTY_ID;
  const startDate = `${daysBack}daysAgo`;
  const endDate = 'today';

  try {
    // Fetch overall metrics with engagement data
    const [overallResponse] = await client.runReport({
      property: propertyId,
      dateRanges: [{ startDate, endDate }],
      dimensions: [],
      metrics: [
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
        { name: 'conversions' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'userEngagementDuration' },
        { name: 'eventCountPerUser' },
      ],
    });

    // Fetch top pages with engagement metrics
    const [pagesResponse] = await client.runReport({
      property: propertyId,
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'pagePath' },
        { name: 'pageTitle' },
      ],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'activeUsers' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
        { name: 'conversions' },
        { name: 'eventCount' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'userEngagementDuration' },
        { name: 'exitRate' },
      ],
      limit: 50,
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    });

    // Fetch traffic sources
    const [sourcesResponse] = await client.runReport({
      property: propertyId,
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
        { name: 'sessionCampaignName' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'bounceRate' },
      ],
      limit: 20,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });

    // Fetch device categories
    const [devicesResponse] = await client.runReport({
      property: propertyId,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'bounceRate' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });

    // Fetch top events
    const [eventsResponse] = await client.runReport({
      property: propertyId,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'eventName' }],
      metrics: [
        { name: 'eventCount' },
        { name: 'activeUsers' },
      ],
      limit: 20,
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    });

    // Fetch scroll depth metrics specifically
    // Note: This requires custom event parameter 'scroll_depth_pct' to be configured in GA4
    let scrollDepthResponse;
    try {
      [scrollDepthResponse] = await client.runReport({
        property: propertyId,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'customEvent:scroll_depth_pct' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: {
              matchType: 'EXACT' as const,
              value: 'scroll_depth',
            },
          },
        },
        metrics: [
          { name: 'eventCount' },
        ],
        orderBys: [{ dimension: { dimensionName: 'customEvent:scroll_depth_pct' } }],
      });
    } catch (scrollError) {
      console.warn('[GA4] Scroll depth query failed (custom parameter may not be configured):', scrollError);
      // Create empty response
      scrollDepthResponse = { rows: [] };
    }

    // Parse overall metrics
    const overall = overallResponse.rows?.[0]?.metricValues ?? [];
    const totalUsers = parseInt(overall[0]?.value ?? '0');
    const totalSessions = parseInt(overall[1]?.value ?? '0');
    const totalPageviews = parseInt(overall[2]?.value ?? '0');
    const avgSessionDuration = parseFloat(overall[3]?.value ?? '0');
    const overallBounceRate = parseFloat(overall[4]?.value ?? '0');
    const totalConversions = parseInt(overall[5]?.value ?? '0');
    const engagedSessions = parseInt(overall[6]?.value ?? '0');
    const engagementRate = parseFloat(overall[7]?.value ?? '0');
    const userEngagementDuration = parseFloat(overall[8]?.value ?? '0');
    const eventCountPerUser = parseFloat(overall[9]?.value ?? '0');

    // Parse engagement metrics
    const engagement: GAEngagementMetrics = {
      engagedSessions,
      engagementRate,
      avgEngagementTimeSeconds: userEngagementDuration,
      eventCountPerUser,
    };

    // Parse scroll depth metrics
    const scrollDepthData = scrollDepthResponse.rows ?? [];
    const scrollDepth25Count = scrollDepthData.find(r => r.dimensionValues?.[0]?.value === '25')?.metricValues?.[0]?.value ?? '0';
    const scrollDepth50Count = scrollDepthData.find(r => r.dimensionValues?.[0]?.value === '50')?.metricValues?.[0]?.value ?? '0';
    const scrollDepth75Count = scrollDepthData.find(r => r.dimensionValues?.[0]?.value === '75')?.metricValues?.[0]?.value ?? '0';
    const scrollDepth90Count = scrollDepthData.find(r => r.dimensionValues?.[0]?.value === '90')?.metricValues?.[0]?.value ?? '0';
    const totalScrollEvents = scrollDepthData.reduce((sum, row) => sum + parseInt(row.metricValues?.[0]?.value ?? '0'), 0);

    // Calculate average scroll depth (weighted average)
    let weightedScrollSum = 0;
    scrollDepthData.forEach(row => {
      const depth = parseInt(row.dimensionValues?.[0]?.value ?? '0');
      const count = parseInt(row.metricValues?.[0]?.value ?? '0');
      weightedScrollSum += depth * count;
    });
    const avgScrollDepth = totalScrollEvents > 0 ? weightedScrollSum / totalScrollEvents : 0;

    const scrollDepth: GAScrollDepthMetrics = {
      scrollDepth25Count: parseInt(scrollDepth25Count),
      scrollDepth50Count: parseInt(scrollDepth50Count),
      scrollDepth75Count: parseInt(scrollDepth75Count),
      scrollDepth90Count: parseInt(scrollDepth90Count),
      totalScrollEvents,
      avgScrollDepth,
    };

    // Parse top pages with engagement
    const topPages: GAPageMetrics[] = (pagesResponse.rows ?? []).map((row) => ({
      path: row.dimensionValues?.[0]?.value ?? '',
      title: row.dimensionValues?.[1]?.value ?? '',
      views: parseInt(row.metricValues?.[0]?.value ?? '0'),
      uniqueUsers: parseInt(row.metricValues?.[1]?.value ?? '0'),
      avgSessionDuration: parseFloat(row.metricValues?.[2]?.value ?? '0'),
      bounceRate: parseFloat(row.metricValues?.[3]?.value ?? '0'),
      conversions: parseInt(row.metricValues?.[4]?.value ?? '0'),
      eventCount: parseInt(row.metricValues?.[5]?.value ?? '0'),
      engagedSessions: parseInt(row.metricValues?.[6]?.value ?? '0'),
      engagementRate: parseFloat(row.metricValues?.[7]?.value ?? '0'),
      avgEngagementTime: parseFloat(row.metricValues?.[8]?.value ?? '0'),
      exitRate: parseFloat(row.metricValues?.[9]?.value ?? '0'),
      // Scroll depth per page would require separate query, using placeholders
      scrollDepth25: 0,
      scrollDepth50: 0,
      scrollDepth75: 0,
      scrollDepth90: 0,
    }));

    // Filter blog posts (paths starting with /blog/)
    const blogPostPerformance = topPages.filter((p) => p.path.startsWith('/blog/'));

    // Parse traffic sources
    const trafficSources: GATrafficSource[] = (sourcesResponse.rows ?? []).map((row) => ({
      source: row.dimensionValues?.[0]?.value ?? '',
      medium: row.dimensionValues?.[1]?.value ?? '',
      campaign: row.dimensionValues?.[2]?.value ?? '',
      sessions: parseInt(row.metricValues?.[0]?.value ?? '0'),
      users: parseInt(row.metricValues?.[1]?.value ?? '0'),
      bounceRate: parseFloat(row.metricValues?.[2]?.value ?? '0'),
    }));

    // Parse device categories
    const deviceCategories: GADeviceCategory[] = (devicesResponse.rows ?? []).map((row) => ({
      deviceCategory: row.dimensionValues?.[0]?.value ?? '',
      sessions: parseInt(row.metricValues?.[0]?.value ?? '0'),
      users: parseInt(row.metricValues?.[1]?.value ?? '0'),
      bounceRate: parseFloat(row.metricValues?.[2]?.value ?? '0'),
    }));

    // Parse top events
    const topEvents: GAEventMetrics[] = (eventsResponse.rows ?? []).map((row) => ({
      eventName: row.dimensionValues?.[0]?.value ?? '',
      eventCount: parseInt(row.metricValues?.[0]?.value ?? '0'),
      uniqueUsers: parseInt(row.metricValues?.[1]?.value ?? '0'),
    }));

    return {
      totalUsers,
      totalSessions,
      totalPageviews,
      avgSessionDuration,
      overallBounceRate,
      totalConversions,
      engagement,
      scrollDepth,
      topPages,
      blogPostPerformance,
      trafficSources,
      deviceCategories,
      topEvents,
      startDate,
      endDate,
    };
  } catch (error) {
    console.error('[GA4] Failed to fetch analytics summary:', error);
    return null;
  }
}

/**
 * Fetch article-specific metrics by slug.
 * Useful for comparing GA4 data with Postgres article_metrics.
 */
export async function getArticleMetrics(
  slug: string,
  daysBack = 30
): Promise<GAPageMetrics | null> {
  const client = getAnalyticsClient();
  if (!client) return null;

  const propertyId = (import.meta as any).env?.GA4_PROPERTY_ID ?? process.env.GA4_PROPERTY_ID;
  const startDate = `${daysBack}daysAgo`;
  const endDate = 'today';
  const pagePath = `/blog/${slug}`;

  try {
    const [response] = await client.runReport({
      property: propertyId,
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'pagePath' },
        { name: 'pageTitle' },
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'pagePath',
          stringFilter: {
            matchType: 'EXACT' as const,
            value: pagePath,
          },
        },
      },
      metrics: [
        { name: 'screenPageViews' },
        { name: 'activeUsers' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
        { name: 'conversions' },
        { name: 'eventCount' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'userEngagementDuration' },
        { name: 'exitRate' },
      ],
    });

    // Fetch scroll depth for this specific page
    const [scrollResponse] = await client.runReport({
      property: propertyId,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'customEvent:scroll_depth_pct' }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: 'eventName',
                stringFilter: {
                  matchType: 'EXACT' as const,
                  value: 'scroll_depth',
                },
              },
            },
            {
              filter: {
                fieldName: 'pagePath',
                stringFilter: {
                  matchType: 'EXACT' as const,
                  value: pagePath,
                },
              },
            },
          ],
        },
      },
      metrics: [{ name: 'eventCount' }],
    });

    const row = response.rows?.[0];
    if (!row) return null;

    // Parse scroll depth for this page
    const scrollData = scrollResponse.rows ?? [];
    const scrollDepth25 = parseInt(scrollData.find(r => r.dimensionValues?.[0]?.value === '25')?.metricValues?.[0]?.value ?? '0');
    const scrollDepth50 = parseInt(scrollData.find(r => r.dimensionValues?.[0]?.value === '50')?.metricValues?.[0]?.value ?? '0');
    const scrollDepth75 = parseInt(scrollData.find(r => r.dimensionValues?.[0]?.value === '75')?.metricValues?.[0]?.value ?? '0');
    const scrollDepth90 = parseInt(scrollData.find(r => r.dimensionValues?.[0]?.value === '90')?.metricValues?.[0]?.value ?? '0');

    return {
      path: row.dimensionValues?.[0]?.value ?? '',
      title: row.dimensionValues?.[1]?.value ?? '',
      views: parseInt(row.metricValues?.[0]?.value ?? '0'),
      uniqueUsers: parseInt(row.metricValues?.[1]?.value ?? '0'),
      avgSessionDuration: parseFloat(row.metricValues?.[2]?.value ?? '0'),
      bounceRate: parseFloat(row.metricValues?.[3]?.value ?? '0'),
      conversions: parseInt(row.metricValues?.[4]?.value ?? '0'),
      eventCount: parseInt(row.metricValues?.[5]?.value ?? '0'),
      engagedSessions: parseInt(row.metricValues?.[6]?.value ?? '0'),
      engagementRate: parseFloat(row.metricValues?.[7]?.value ?? '0'),
      avgEngagementTime: parseFloat(row.metricValues?.[8]?.value ?? '0'),
      exitRate: parseFloat(row.metricValues?.[9]?.value ?? '0'),
      scrollDepth25,
      scrollDepth50,
      scrollDepth75,
      scrollDepth90,
    };
  } catch (error) {
    console.error(`[GA4] Failed to fetch metrics for article: ${slug}`, error);
    return null;
  }
}

/**
 * Fetch conversion events (affiliate clicks, newsletter signups, etc.)
 */
export async function getConversionEvents(
  daysBack = 30
): Promise<GAEventMetrics[]> {
  const client = getAnalyticsClient();
  if (!client) return [];

  const propertyId = (import.meta as any).env?.GA4_PROPERTY_ID ?? process.env.GA4_PROPERTY_ID;
  const startDate = `${daysBack}daysAgo`;
  const endDate = 'today';

  try {
    const [response] = await client.runReport({
      property: propertyId,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'eventName' }],
      dimensionFilter: {
        orGroup: {
          expressions: [
            {
              filter: {
                fieldName: 'eventName',
                stringFilter: {
                  matchType: 'CONTAINS' as const,
                  value: 'affiliate',
                },
              },
            },
            {
              filter: {
                fieldName: 'eventName',
                stringFilter: {
                  matchType: 'CONTAINS' as const,
                  value: 'conversion',
                },
              },
            },
            {
              filter: {
                fieldName: 'eventName',
                stringFilter: {
                  matchType: 'CONTAINS' as const,
                  value: 'newsletter',
                },
              },
            },
          ],
        },
      },
      metrics: [
        { name: 'eventCount' },
        { name: 'activeUsers' },
      ],
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    });

    return (response.rows ?? []).map((row) => ({
      eventName: row.dimensionValues?.[0]?.value ?? '',
      eventCount: parseInt(row.metricValues?.[0]?.value ?? '0'),
      uniqueUsers: parseInt(row.metricValues?.[1]?.value ?? '0'),
    }));
  } catch (error) {
    console.error('[GA4] Failed to fetch conversion events:', error);
    return [];
  }
}

/**
 * Test connection and return basic property info.
 */
export async function testConnection(): Promise<boolean> {
  const client = getAnalyticsClient();
  if (!client) return false;

  const propertyId = (import.meta as any).env?.GA4_PROPERTY_ID ?? process.env.GA4_PROPERTY_ID;

  try {
    await client.runReport({
      property: propertyId,
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      dimensions: [],
      metrics: [{ name: 'totalUsers' }],
    });
    console.log('[GA4] ✅ Connection test successful');
    return true;
  } catch (error) {
    console.error('[GA4] ❌ Connection test failed:', error);
    return false;
  }
}
