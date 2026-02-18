import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';

import { db, Post, eq, desc } from 'astro:db';

export async function GET(context) {
    const posts = await getCollection('blog');
    const dbPosts = await db.select().from(Post).where(eq(Post.status, 'published')).orderBy(desc(Post.pubDate));

    // Combine and sort
    const allPosts = [
        ...posts.map((post) => ({
            title: post.data.title,
            pubDate: post.data.pubDate,
            description: post.data.description,
            link: `/blog/${post.slug}`,
        })),
        ...dbPosts.map((post) => ({
            title: post.title,
            pubDate: post.pubDate,
            description: post.description,
            link: `/blog/${post.slug}`,
        }))
    ].sort((a, b) => new Date(b.pubDate).valueOf() - new Date(a.pubDate).valueOf());

    return rss({
        title: SITE_TITLE,
        description: SITE_DESCRIPTION,
        site: context.site,
        items: allPosts,
    });
}
