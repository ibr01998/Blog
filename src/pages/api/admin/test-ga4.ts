/**
 * GET /api/admin/test-ga4
 *
 * Tests Google Analytics 4 API connection and returns sample data.
 * Protected by dashboard session cookie via middleware.ts
 */

import type { APIRoute } from 'astro';
import { testConnection, getAnalyticsSummary } from '../../../lib/analytics/ga4.ts';

export const GET: APIRoute = async () => {
  try {
    console.log('[test-ga4] Testing GA4 connection...');

    // Test basic connection
    const isConnected = await testConnection();

    if (!isConnected) {
      return new Response(JSON.stringify({
        success: false,
        error: 'GA4 connection failed. Check credentials and environment variables.',
        details: {
          required_env_vars: [
            'GA4_PROPERTY_ID (format: properties/123456789)',
            'GA4_SERVICE_ACCOUNT_EMAIL',
            'GA4_PRIVATE_KEY (base64 encoded)',
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fetch sample data (last 7 days)
    const summary = await getAnalyticsSummary(7);

    return new Response(JSON.stringify({
      success: true,
      message: 'GA4 connection successful!',
      sample_data: summary ? {
        total_users: summary.totalUsers,
        total_sessions: summary.totalSessions,
        total_pageviews: summary.totalPageviews,
        avg_session_duration: `${(summary.avgSessionDuration / 60).toFixed(1)} minutes`,
        bounce_rate: `${(summary.overallBounceRate * 100).toFixed(1)}%`,
        conversions: summary.totalConversions,
        top_blog_posts: summary.blogPostPerformance.slice(0, 5).map(p => ({
          path: p.path,
          title: p.title,
          views: p.views,
          conversions: p.conversions,
        })),
        top_traffic_sources: summary.trafficSources.slice(0, 3).map(s => ({
          source: s.source,
          medium: s.medium,
          sessions: s.sessions,
        })),
      } : null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[test-ga4] Error:', errorMessage);

    return new Response(JSON.stringify({
      success: false,
      error: 'GA4 test failed',
      details: errorMessage,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
