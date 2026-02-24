/**
 * Vercel Function Warmer
 * 
 * Call this endpoint periodically to keep functions warm and reduce cold starts.
 * On free tier, functions spin down after ~5-15 min of inactivity.
 * 
 * Usage:
 * - Add to GitHub Actions (cron every 10 min)
 * - Use a service like cron-job.org
 * - Vercel Cron Jobs (limited on free tier)
 */

const SITE_URL = process.env.SITE_URL || 'https://shortnews.tech';
const PAGES_TO_WARM = [
  '/',
  '/blog',
  '/about',
  '/blog/bybit-review-2026-ervaringen', // Most popular article
];

async function warmup() {
  console.log(`[${new Date().toISOString()}] Starting warmup...`);
  
  for (const page of PAGES_TO_WARM) {
    const url = `${SITE_URL}${page}`;
    const start = Date.now();
    
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Vercel-Warmer/1.0',
        },
      });
      
      const duration = Date.now() - start;
      console.log(`✓ ${page} - ${response.status} (${duration}ms)`);
    } catch (error) {
      console.error(`✗ ${page} - ${error.message}`);
    }
    
    // Small delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log(`[${new Date().toISOString()}] Warmup complete`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  warmup();
}

export { warmup };
