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
    status: column.text({ optional: true, default: 'published' }), // 'published' | 'draft'
    author: column.text({ optional: true, default: 'Redactie' }),
    readingTime: column.number({ optional: true, default: 6 }),
  }
});

const Platform = defineTable({
  columns: {
    id: column.text({ primaryKey: true }),
    name: column.text(),
    slug: column.text(),
    affiliateLink: column.text({ optional: true }),
    founded: column.number({ optional: true }),
    headquarters: column.text({ optional: true }),
    maxLeverage: column.text({ optional: true }),
    makerFee: column.text({ optional: true }),
    takerFee: column.text({ optional: true }),
    tradingPairs: column.text({ optional: true }),
    features: column.json({ optional: true }), // Array of strings
    pros: column.json({ optional: true }),
    cons: column.json({ optional: true }),
    bestFor: column.text({ optional: true }),
    shortDescription: column.text({ optional: true }),
  }
});

const AnalyticsView = defineTable({
  columns: {
    id: column.text({ primaryKey: true }),
    slug: column.text(),
    timestamp: column.date(),
    duration: column.number({ optional: true, default: 0 }), // Duration in seconds
    source: column.text({ optional: true }), // Referrer
    userAgent: column.text({ optional: true }),
    country: column.text({ optional: true }),
    visitorId: column.text({ optional: true })
  }
});

const AnalyticsClick = defineTable({
  columns: {
    id: column.text({ primaryKey: true }),
    slug: column.text(),
    link: column.text(), // The URL clicked
    timestamp: column.date(),
    type: column.text({ optional: true }) // 'affiliate', 'internal', 'external'
  }
});

// https://astro.build/db/config
export default defineDb({
  tables: { Post, Platform, AnalyticsView, AnalyticsClick }
});
