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
import { db, Platform, inArray } from 'astro:db';
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
        block_id: z.string().describe('Uniek ID voor dit blok (bv. intro, platform_binance_pros, conclusion)'),
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
            target_audience = '',
            article_angle = '',
            custom_instructions = '',
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

        // Get platform data from DB
        let platformData: any[] = [];
        if (platformIds.length > 0) {
            platformData = await db.select().from(Platform).where(inArray(Platform.slug, platformIds));
        }

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

        // --- Dynamic Structure Logic ---
        // Instead of using the static template structure, we build a guide based on platforms.
        let structuralGuide = '';

        if (intent === 'comparison' && platformData.length > 0) {
            structuralGuide = `
                STRUCTUUR-EISEN VOOR DEZE VERGELIJKING:
                1. Introductie (waarom deze vergelijking?)
                ${platformData.map(p => `2. ${p.name} - Overzicht (sterke punten, korte bio)`).join('\n')}
                3. Vergelijkingstabel & Analyse (vergelijk ${platformData.map(p => p.name).join(' vs ')})
                4. Diepte-analyse: Fees & Costs (wie is goedkoper?)
                ${platformData.map(p => `5. Wanneer kies je ${p.name}? (specifiek doelgroep)`).join('\n')}
                6. Conclusie & Eindoordeel
            `;
        } else if (intent === 'review' && platformData.length === 1) {
            const p = platformData[0];
            structuralGuide = `
                STRUCTUUR-EISEN VOOR DEZE REVIEW:
                1. Introductie
                2. Wat is ${p.name}?
                3. Features & Verborgen Parels
                4. Fees & Kosten (eerlijke analyse)
                5. Veiligheid & Betrouwbaarheid
                6. Voor- en Nadelen
                7. Conclusie: Is ${p.name} de moeite waard?
             `;
        } else {
            // Fallback to template defaults key
            structuralGuide = `STRUCTUUR-EISEN:\n` + template.headingStructure.join(' -> ');
        }


        const systemPrompt = `Je bent een redactie-assistent voor ShortNews.
Je taak is om een gestructureerde outline te maken voor een artikel over "${target_keyword}".

REGELS:
- Nederlands
- Doelgroep: Crypto traders
- Unieke invalshoek
- GEBRUIK DE OPGEGEVEN PLATFORMEN VOOR DE STRUCTUUR

TOON: ${tone}
MONETISATIE: ${monetization_priority}
DOELGROEP: ${target_audience || 'Nederlandse crypto traders'}
INVALSHOEK: ${article_angle || 'Eerlijke, behulpzame analyse'}
SPECIFIEKE INSTRUCTIES: ${custom_instructions || 'Geen extra instructies.'}`;

        const userPrompt = `Maak een outline.

Type: ${template.label}
Geselecteerde Platformen: ${platformData.map(p => p.name).join(', ')}

${structuralGuide}

PLATFORM DATA (Gebruik deze feitelijke info):
${platformData.map((p) => `
${p.name} (${p.slug}):
- Opgericht: ${p.founded}
- Fees: Maker ${p.makerFee} / Taker ${p.takerFee}
- Pairs: ${p.tradingPairs}
- USP: ${p.bestFor}
`).join('\n')}

${include_faq ? 'Voeg een FAQ sectie toe.' : ''}

BESCHIKBARE BLOK-TYPES: Gebruik logische IDs zoals 'intro', 'platform_binance_overzicht', 'vergelijkingstabel', 'conclusie'. Je mag zelf IDs bedenken die passen bij de sectie.`;

        const result = await generateObject({
            model: openai('gpt-4o'), // Switch to gpt-4o for reliable structured output
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
        console.error('Outline generation error full details:', error);
        // return full error for debugging
        return new Response(JSON.stringify({
            error: 'Er ging iets mis bij het genereren van de outline.',
            details: error?.message || 'Unknown error',
            stack: error?.stack,
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
