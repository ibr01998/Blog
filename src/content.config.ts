import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
    type: 'content',
    schema: z.object({
        // Core fields (required)
        title: z.string(),
        description: z.string(),
        pubDate: z.coerce.date(),

        // Core fields (optional)
        updatedDate: z.coerce.date().optional(),
        heroImage: z.string().optional(),
        affiliateLink: z.string().optional(),
        affiliateText: z.string().optional(),

        // Content Engine structured fields
        target_keyword: z.string().optional(),
        seo_title: z.string().optional(),
        article_type: z.enum(['comparison', 'review', 'bonus', 'trust', 'fee']).optional(),
        platforms: z.array(z.string()).optional(),
        faq_items: z.array(z.object({
            question: z.string(),
            answer: z.string(),
        })).optional(),
        cta_blocks: z.array(z.object({
            position: z.string(),
            platform: z.string(),
            anchor_text: z.string(),
        })).optional(),
        internal_links: z.array(z.object({
            anchor: z.string(),
            slug: z.string(),
        })).optional(),
        generation_metadata: z.object({
            generated_at: z.string().optional(),
            model: z.string().optional(),
            intent: z.string().optional(),
        }).optional(),
    }),
});

export const collections = { blog };
