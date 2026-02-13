
import type { APIRoute } from 'astro';
import { db, Post, eq } from 'astro:db';

// Helper to sanitize filenames
function sanitize(str: string) {
    return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

export const DELETE: APIRoute = async ({ params }) => {
    const slug = params.slug;

    if (!slug) {
        return new Response(JSON.stringify({ error: 'Slug is required' }), { status: 400 });
    }

    try {
        await db.delete(Post).where(eq(Post.slug, slug));
        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error: any) {
        console.error('Delete error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};

export const PATCH: APIRoute = async ({ params, request }) => {
    const slug = params.slug;

    if (!slug) {
        return new Response(JSON.stringify({ error: 'Slug is required' }), { status: 400 });
    }

    try {
        const body = await request.json();
        const { status } = body;

        // Verify article exists
        const existing = await db.select().from(Post).where(eq(Post.slug, slug)).get();
        if (!existing) {
            return new Response(JSON.stringify({ error: 'Article not found' }), { status: 404 });
        }

        if (status) {
            // Update status (publish/unpublish)
            await db.update(Post).set({ status }).where(eq(Post.slug, slug));
        }

        return new Response(JSON.stringify({ success: true }), { status: 200 });

    } catch (error: any) {
        console.error('Update error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};

// PUT used for full article update (Edit Save)
export const PUT: APIRoute = async ({ params, request }) => {
    const slug = params.slug;

    if (!slug) {
        return new Response(JSON.stringify({ error: 'Slug is required' }), { status: 400 });
    }

    try {
        const data = await request.json();
        const {
            title,
            description,
            heroImage,
            pubDate,
            target_keyword,
            seo_title,
            article_type,
            blocks,
            platforms,
            status
        } = data;

        // Construct MDX content (same logic as create)
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

        await db.update(Post).set({
            title,
            description,
            body: frontmatter,
            pubDate: new Date(pubDate),
            heroImage,
            target_keyword,
            seo_title,
            article_type,
            platforms,
            blocks,
            updatedDate: new Date(),
            status: status || 'published'
        }).where(eq(Post.slug, slug));

        return new Response(JSON.stringify({ success: true }), { status: 200 });

    } catch (error: any) {
        console.error('Update error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
