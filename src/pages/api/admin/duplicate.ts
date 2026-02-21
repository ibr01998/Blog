/**
 * POST /api/admin/duplicate
 *
 * Duplicates an existing Astro DB article.
 * Body: { slug: string }
 * Returns: { success: true, slug: string }
 *
 * Protected by dashboard session cookie (via middleware.ts).
 */

import type { APIRoute } from 'astro';
import { db, Post, eq } from 'astro:db';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { slug } = await request.json();

    if (!slug || typeof slug !== 'string') {
      return new Response(JSON.stringify({ error: 'Slug is required' }), { status: 400 });
    }

    // Fetch the original article
    const original = await db.select().from(Post).where(eq(Post.slug, slug)).get();
    if (!original) {
      return new Response(JSON.stringify({ error: 'Artikel niet gevonden' }), { status: 404 });
    }

    // Generate a unique slug for the copy
    let newSlug = `${slug}-kopie`;
    let attempt = 1;
    while (true) {
      const existing = await db.select().from(Post).where(eq(Post.slug, newSlug)).get();
      if (!existing) break;
      attempt++;
      newSlug = `${slug}-kopie-${attempt}`;
    }

    // Insert duplicate as a draft
    await db.insert(Post).values({
      slug: newSlug,
      title: `${original.title} (kopie)`,
      description: original.description,
      body: original.body,
      pubDate: new Date(),
      updatedDate: new Date(),
      heroImage: original.heroImage,
      target_keyword: original.target_keyword,
      seo_title: `${original.seo_title} (kopie)`,
      article_type: original.article_type,
      platforms: original.platforms,
      blocks: original.blocks,
      status: 'draft',
    });

    return new Response(JSON.stringify({ success: true, slug: newSlug }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
