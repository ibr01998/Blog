/**
 * POST /api/articles
 * Saves a generated article.
 * 
 * ENVIRONMENT-AWARE SAVING:
 * - Local Dev (npm run dev): Writes directly to local filesystem.
 * - Production (Vercel): Commits to GitHub repository via API to trigger a new build.
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

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

        // --- SAVE LOGIC ---

        // 1. Check if we are in Development Mode
        if (import.meta.env.DEV) {
            try {
                const projectRoot = process.cwd();
                const filePath = path.join(projectRoot, 'src', 'content', 'blog', `${sanitize(slug)}.mdx`);
                await fs.writeFile(filePath, frontmatter, 'utf-8');
                return new Response(JSON.stringify({ success: true, mode: 'local', path: filePath }), { status: 200 });
            } catch (e: any) {
                console.error('Local save failed:', e);
                throw new Error(`Local save failed: ${e.message}`);
            }
        }

        // 2. Production Mode -> Commit to GitHub
        const GITHUB_TOKEN = import.meta.env.GITHUB_TOKEN;
        const REPO_OWNER = import.meta.env.GITHUB_OWNER || 'ibr01998'; // Defaulting to your username
        const REPO_NAME = import.meta.env.GITHUB_REPO || 'Blog';       // Defaulting to your repo
        const BRANCH = import.meta.env.GITHUB_BRANCH || 'main';

        if (!GITHUB_TOKEN) {
            return new Response(JSON.stringify({
                error: 'Configuration Error: GITHUB_TOKEN is missing in Vercel Environment Variables.'
            }), { status: 500 });
        }

        const filePath = `src/content/blog/${sanitize(slug)}.mdx`;
        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;

        // A. Check if file exists (to get SHA for update)
        let sha: string | undefined;
        try {
            const checkRes = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'User-Agent': 'ShortNews-CMS',
                    'Accept': 'application/vnd.github.v3+json',
                }
            });
            if (checkRes.ok) {
                const data = await checkRes.json();
                sha = data.sha;
            }
        } catch (e) {
            // ignore network errors, assume new file
        }

        // B. Commit File
        const payload = {
            message: `chore(content): publish article "${title}"`,
            content: Buffer.from(frontmatter).toString('base64'),
            branch: BRANCH,
            ...(sha ? { sha } : {})
        };

        const uploadRes = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'User-Agent': 'ShortNews-CMS',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!uploadRes.ok) {
            const errorText = await uploadRes.text();
            throw new Error(`GitHub API Error: ${errorText}`);
        }

        return new Response(JSON.stringify({ success: true, mode: 'github' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error: any) {
        console.error('Save error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
