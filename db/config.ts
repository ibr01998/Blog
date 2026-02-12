import { defineDb, defineTable, column } from 'astro:db';

const Post = defineTable({
  columns: {
    slug: column.text({ primaryKey: true }),
    title: column.text(),
    description: column.text(),
    body: column.text(), // The full MDX content
    pubDate: column.date(),
    heroImage: column.text({ optional: true }),
    target_keyword: column.text(),
    seo_title: column.text(),
    article_type: column.text(),
    platforms: column.json({ optional: true }),
    blocks: column.json({ optional: true }), // Store structured blocks for potential re-editing
    updatedDate: column.date({ optional: true }),
  }
});

// https://astro.build/db/config
export default defineDb({
  tables: { Post }
});
