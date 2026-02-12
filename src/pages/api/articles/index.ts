/**
 * POST /api/articles
 * Saves a generated article.
 * 
 * ENVIRONMENT-AWARE SAVING:
 * - Local Dev (npm run dev): Writes directly to local filesystem.
 * - Production (Vercel): Commits to GitHub repository via API to trigger a new build.
 */
import type { APIRoute } from 'astro';
import { db, Post } from 'astro:db';

// Helper to sanitize filenames
function sanitize(str: string) {
    return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();
        const {
            title,
            description,
            slug,
            heroImage,
            pubDate,
            target_keyword,
            seo_title,
            article_type,
            blocks,
            platforms
        } = data;

        if (!title || !slug || !blocks) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
        }

        // Construct MDX content
        const frontmatter = `---
title: '${title.replace(/'/g, "''")}'
description: '${description.replace(/'/g, "''")}'
pubDate: '${new Date(pubDate).toISOString()}'
heroImage: '${heroImage || "/blog-placeholder-1.jpg"}'
target_keyword: '${target_keyword}'
seo_title: '${seo_title}'
article_type: '${article_type}'
platforms: ${JSON.stringify(platforms || [])}
---
import CtaButton from '../../components/CtaButton.astro';

${blocks.map((b: any) => `
## ${b.heading}

${b.content}
`).join('\n\n')}
`;

        // --- SAVE LOGIC (ASTRO DB) ---
        // Universal storage for both dev and production

        try {
            await db.insert(Post).values({
                slug: sanitize(slug),
                title,
                description,
                body: frontmatter, // We store the full MDX content with frontmatter for now, or just the body? 
                // Actually, the `body` column usually stores the content. 
                // If I want to render it later as MDX, I might need to strip frontmatter or store strictly the body.
                // But for now, let's store the full generated string.
                pubDate: new Date(pubDate),
                heroImage,
                target_keyword,
                seo_title,
                article_type,
                platforms,
                blocks,
                updatedDate: new Date(),
            });

            return new Response(JSON.stringify({ success: true, mode: 'database', slug: sanitize(slug) }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (dbError: any) {
            // Handle duplicate slug error
            if (dbError.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
                return new Response(JSON.stringify({ error: 'Een artikel met deze slug bestaat al.' }), { status: 409 });
            }
            throw dbError;
        }

    } catch (error: any) {
        console.error('Save error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
