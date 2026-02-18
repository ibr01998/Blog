export const prerender = false;

import { getCollection } from 'astro:content';
import { db, Post, eq, desc } from 'astro:db';

export async function GET(context) {
  const siteUrl = context.site ? context.site.toString().replace(/\/+$/, '') : 'https://shortnews.tech';

  // 1. Get Collection Posts
  const collectionPosts = await getCollection('blog');

  // 2. Get DB Posts (only published)
  let dbPosts: any[] = [];
  try {
    dbPosts = await db.select().from(Post).where(eq(Post.status, 'published')).orderBy(desc(Post.pubDate));
  } catch (error) {
    console.error('Sitemap: Error fetching DB posts:', error);
    // Continue without DB posts to ensure sitemap still generates
  }

  // 3. Define Static Pages
  const staticPages = [
    '',
    '/blog',
    '/about',
    '/contact',
    '/privacy',
    '/terms',
  ];

  // 4. Build XML
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${staticPages.map((page) => `
  <url>
    <loc>${siteUrl}${page}</loc>
    <changefreq>daily</changefreq>
    <priority>${page === '' ? '1.0' : '0.8'}</priority>
  </url>
  `).join('')}
  ${collectionPosts.map((post) => `
  <url>
    <loc>${siteUrl}/blog/${post.slug}/</loc>
    <lastmod>${post.data.updatedDate?.toISOString() || post.data.pubDate.toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  `).join('')}
  ${dbPosts.map((post) => `
  <url>
    <loc>${siteUrl}/blog/${post.slug}</loc>
    <lastmod>${post.updatedDate ? new Date(post.updatedDate).toISOString() : new Date(post.pubDate).toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  `).join('')}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600'
    },
  });
}
