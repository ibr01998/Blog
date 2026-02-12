/**
 * POST /api/generate/outline
 * Generates a structured article outline using OpenAI reasoning model.
 * Accepts: target_keyword, article_type, platforms, tone, monetization_priority
 * Returns: structured outline with H1/H2/H3, article angle, target user profile
 */
import type { APIRoute } from 'astro';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getPlatforms } from '../../../data/platforms';
import { getTemplate, classifyIntent, type ArticleIntent } from '../../../data/templates';
import { getActiveAffiliates } from '../../../data/affiliates';
import { getCollection } from 'astro:content';

const outlineSchema = z.object({
    title: z.string().describe('SEO-geoptimaliseerde H1 titel in het Nederlands, max 70 tekens'),
    seo_title: z.string().describe('Meta title voor zoekresultaten, max 60 tekens'),
    meta_description: z.string().describe('Meta description, max 155 tekens, actiegericht'),
    slug: z.string().describe('URL-slug, lowercase, hyphens, geen speciale tekens'),
    article_angle: z.string().describe('Unieke invalshoek van dit artikel in 1-2 zinnen'),
    target_user: z.string().describe('Beschrijving van de doellezer in 1 zin'),
    monetization_notes: z.string().describe('Hoe dit artikel converteert: welke affiliate placements maken zin'),
    sections: z.array(z.object({
        heading: z.string().describe('De H2 of H3 heading'),
        level: z.enum(['h2', 'h3']).describe('Heading level'),
        summary: z.string().describe('Wat deze sectie moet behandelen, in 1-2 zinnen'),
        block_id: z.string().describe('ID dat verwijst naar het bloktype uit het template'),
    })),
    faq_suggestions: z.array(z.object({
        question: z.string(),
        answer_hint: z.string().describe('Richting voor het antwoord, niet het volledige antwoord'),
    })).describe('3-5 FAQ-suggesties relevant voor dit keyword'),
});

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const {
            target_keyword,
            article_type: userArticleType,
            platforms: platformIds = [],
            tone = 'neutral',
            monetization_priority = 'revenue_share',
            include_faq = true,
        } = body;

        if (!target_keyword) {
            return new Response(JSON.stringify({ error: 'target_keyword is verplicht' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Auto-classify intent if not provided
        const intent: ArticleIntent = userArticleType || classifyIntent(target_keyword);
        const template = getTemplate(intent);

        // Get platform data for context
        const platformData = getPlatforms(platformIds);
        const affiliates = getActiveAffiliates();

        // Get existing posts for context awareness (avoid duplication)
        let existingPosts: { title: string; slug: string; type?: string }[] = [];
        try {
            const posts = await getCollection('blog');
            existingPosts = posts.map((p) => ({
                title: p.data.title,
                slug: p.slug,
                type: p.data.article_type,
            }));
        } catch {
            // Content collection may be empty
        }

        const systemPrompt = `Je bent een redactie-assistent voor ShortNews, een Nederlands/Belgische crypto-affiliate website.
Je taak is om een gestructureerde outline te maken voor een blogartikel.

REGELS:
- Schrijf ALLES in het Nederlands
- De doelgroep is Nederlandse en Belgische crypto traders
- Genereer GEEN generieke structuren — elke outline moet een unieke invalshoek hebben
- Gebruik feitelijke data waar mogelijk
- De outline moet aansluiten bij het zoekintent: "${intent}" (${template.description})
- Vermijd structuren die lijken op bestaande artikelen
- Wees specifiek, geen vage beloftes

TOON: ${tone === 'neutral' ? 'Objectief en informatief' : tone === 'opinionated' ? 'Mild opiniërend maar eerlijk' : 'Direct en no-nonsense'}

MONETISATIE: Prioriteit is ${monetization_priority === 'cpa' ? 'CPA (kosten per actie)' : 'Revenue share (commissie op fees)'}

${include_faq ? 'GENEREER 3-5 FAQ items die relevant zijn voor het zoekwoord.' : 'GEEN FAQ items nodig.'}`;

        const userPrompt = `Maak een outline voor een artikel over: "${target_keyword}"

Type: ${template.label}
Template structuur: ${template.headingStructure.join(' → ')}

${platformData.length > 0 ? `
PLATFORM DATA (gebruik deze feitelijke gegevens, NIET verzonnen data):
${platformData.map((p) => `
${p.name}:
- Opgericht: ${p.founded}
- Max leverage: ${p.maxLeverage}
- Maker fee: ${p.makerFee}
- Taker fee: ${p.takerFee}
- Trading pairs: ${p.tradingPairs}
- Best voor: ${p.bestFor}
`).join('\n')}` : ''}

${existingPosts.length > 0 ? `
BESTAANDE ARTIKELEN (vermijd duplicatie):
${existingPosts.map((p) => `- "${p.title}" (${p.slug})`).join('\n')}
` : ''}

BESCHIKBARE BLOK-TYPES: ${template.blocks.map((b) => `${b.id} (${b.label})`).join(', ')}

Beschikbare affiliates: ${affiliates.map((a) => a.name).join(', ')}`;

        const result = await generateObject({
            model: openai('o4-mini'),
            schema: outlineSchema,
            system: systemPrompt,
            prompt: userPrompt,
        });

        return new Response(JSON.stringify({
            outline: result.object,
            intent,
            template: template.intent,
            template_label: template.label,
            platforms: platformIds,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error('Outline generation error:', error);
        return new Response(JSON.stringify({
            error: 'Er ging iets mis bij het genereren van de outline.',
            details: error?.message || 'Unknown error',
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
