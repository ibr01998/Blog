/**
 * Publish Utilities — shared publishing logic for the autonomous editorial engine.
 *
 * Extracted from /api/admin/articles/[id].ts so the orchestrator can
 * auto-publish articles without going through the API route.
 *
 * Functions:
 *  - publishToPostTable(article) — dual-write to Astro DB Post table
 *  - extractPlatformSlugs(markdown) — extract /go/{slug} references
 *  - pingGoogleIndexing(url) — notify Google of a new URL
 *  - notifyStrategist(articleId) — record publish event for feedback loop
 *
 * IMPORTANT: This file imports 'astro:db' — only use in server-rendered contexts.
 */

import { db, Post, Platform, inArray } from 'astro:db';
import { query } from './db/postgres.ts';

export interface PublishableArticle {
    id: string;
    title: string;
    slug: string;
    meta_description: string;
    meta_title: string;
    article_markdown: string;
    primary_keyword: string;
    format_type: string;
    image_url: string | null;
    author: string;
    reading_time: number;
}

/**
 * Extract unique /go/{slug} platform slugs from article markdown.
 */
export function extractPlatformSlugs(markdown: string): string[] {
    const matches = [...markdown.matchAll(/\/go\/([a-zA-Z0-9_-]+)/g)];
    return [...new Set(matches.map((m) => m[1].toLowerCase()))];
}

/**
 * Write a published article to the Astro DB Post table.
 * This is the dual-write that makes articles appear on the public-facing blog.
 *
 * Uses onConflictDoUpdate so it's safe to call multiple times for the same slug.
 */
export async function publishToPostTable(article: PublishableArticle): Promise<void> {
    const extractedPlatforms = extractPlatformSlugs(article.article_markdown);

    // Validate that all extracted platform slugs actually exist in Platform table
    let platforms: string[] = [];
    if (extractedPlatforms.length > 0) {
        const validPlatforms = await db.select().from(Platform).where(
            inArray(Platform.slug, extractedPlatforms)
        );
        const validSlugs = new Set(validPlatforms.map(p => p.slug));
        platforms = extractedPlatforms.filter(slug => validSlugs.has(slug));

        const invalidPlatforms = extractedPlatforms.filter(slug => !validSlugs.has(slug));
        if (invalidPlatforms.length > 0) {
            console.warn(`[publishToPostTable] Invalid platform slugs in article ${article.slug}:`, invalidPlatforms);
        }
    }

    await db.insert(Post).values({
        slug: article.slug,
        title: article.title,
        description: article.meta_description || '',
        body: article.article_markdown,
        pubDate: new Date(),
        target_keyword: article.primary_keyword,
        seo_title: article.meta_title || article.title,
        article_type: article.format_type as any,
        heroImage: article.image_url || '',
        platforms,
        status: 'published',
        author: article.author || 'Redactie',
        readingTime: article.reading_time || 6,
    }).onConflictDoUpdate({
        target: Post.slug,
        set: {
            body: article.article_markdown,
            title: article.title,
            description: article.meta_description || '',
            heroImage: article.image_url || '',
            platforms,
            status: 'published',
            author: article.author || 'Redactie',
            readingTime: article.reading_time || 6,
        },
    });
}

/**
 * Ping Google Indexing API to notify of a new or updated URL.
 * Requires GOOGLE_INDEXING_KEY env var (base64-encoded service account key).
 *
 * Falls back silently if credentials are not configured — this is a
 * best-effort optimization, not a required step.
 */
export async function pingGoogleIndexing(articleUrl: string): Promise<boolean> {
    try {
        const keyBase64 = process.env.GOOGLE_INDEXING_KEY ??
            (import.meta as any).env?.GOOGLE_INDEXING_KEY;

        if (!keyBase64) {
            console.info('[pingGoogleIndexing] GOOGLE_INDEXING_KEY not set — skipping indexing ping');
            return false;
        }

        // Decode and parse the service account key
        const keyJson = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf-8'));

        // Create JWT for Google Indexing API
        // Using the built-in crypto for JWT signing
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({
            iss: keyJson.client_email,
            scope: 'https://www.googleapis.com/auth/indexing',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now,
        })).toString('base64url');

        // For now, log the intent and skip actual JWT signing (requires crypto lib)
        // The full implementation would sign with the private key
        console.info(`[pingGoogleIndexing] Would ping Google Indexing API for: ${articleUrl}`);
        console.info('[pingGoogleIndexing] Full JWT signing requires @google-auth-library — skipping actual HTTP call');

        return false; // Return false until full signing is implemented
    } catch (err) {
        console.warn('[pingGoogleIndexing] Failed:', err);
        return false;
    }
}

/**
 * Record a publish event in the Postgres system for the strategist feedback loop.
 * Updates the article's published_at timestamp and status.
 */
export async function recordPublishEvent(articleId: string): Promise<void> {
    try {
        await query(
            `UPDATE articles
       SET status = 'published',
           published_at = NOW()
       WHERE id = $1`,
            [articleId]
        );

        // Create initial metrics row if it doesn't exist
        await query(
            `INSERT INTO article_metrics (article_id)
       SELECT $1
       WHERE NOT EXISTS (SELECT 1 FROM article_metrics WHERE article_id = $1)`,
            [articleId]
        );
    } catch (err) {
        console.warn('[recordPublishEvent] Failed:', err);
    }
}
