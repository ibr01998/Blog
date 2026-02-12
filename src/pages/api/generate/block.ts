/**
 * POST /api/generate/block
 * Generates a single content block using a fast, cheaper model.
 * Takes the approved outline + block type + previously generated blocks as context.
 */
import type { APIRoute } from 'astro';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db, Platform, inArray } from 'astro:db';
import { getActiveAffiliates } from '../../../data/affiliates';

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const {
            block_id,
            block_label,
            block_description,
            outline,
            platforms: platformIds = [],
            previous_blocks = [],
            tone = 'neutral',
            target_keyword = '',
            model_provider = 'openai',
        } = body;

        if (!block_id || !outline) {
            return new Response(JSON.stringify({ error: 'block_id en outline zijn verplicht' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Get platform data from DB
        let platformData: any[] = [];
        if (platformIds.length > 0) {
            platformData = await db.select().from(Platform).where(inArray(Platform.slug, platformIds));
        }
        const affiliates = getActiveAffiliates();

        // Find the section info from the outline
        const section = outline.sections?.find((s: any) => s.block_id === block_id);
        const heading = section?.heading || block_label;

        // Special handling for TLDR blocks
        const isTldr = block_id === 'tldr';

        // Determine if this block should get an image (after ~2nd content block)
        const contentBlockIndex = previous_blocks.filter((b: any) => b.block_id !== 'tldr').length;
        const shouldInjectImage = contentBlockIndex === 2; // After 2nd real content block

        const systemPrompt = isTldr
            ? `Je bent een ervaren redacteur voor ShortNews, een Nederlands crypto-affiliate website.
Je schrijft een TLDR (samenvatting) voor bovenaan het artikel "${outline.title}".

REGELS:
- Schrijf in het Nederlands
- Maak een beknopte samenvatting in 3-5 bullet points
- Elke bullet bevat een kernpunt van het artikel
- Verwerk de platformnamen NATUURLIJK in de tekst, met een link waar het logisch past
  Voorbeeld: "**BitMEX** biedt de [laagste maker-fees](/go/bitmex) in de markt"
- Houd het onder 80 woorden
- Gebruik markdown bold (**) voor platformnamen en kernwoorden
- GEEN inleiding, begin direct met de bullets
- Format: een korte ongenummerde lijst`
            : `Je bent een ervaren redacteur voor ShortNews, een Nederlands crypto-affiliate website.
Je schrijft NU één blok van een artikel. Dit blok heet: "${block_label}".

SCHRIJFREGELS:
- Schrijf ALLES in het Nederlands
- GEEN inleidende zinnen zoals "In dit artikel..." of "Laten we eens kijken naar..."
- Varieer zinslengte: korte directe zinnen afgewisseld met langere uitleg
- Voeg milde, eerlijke meningen toe — geen corporate taalgebruik
- Noem concrete cijfers, fees, en feiten waar relevant
- Vermijd opsommingen tenzij ze écht nodig zijn (max 4-5 bullets per lijst)
- GEEN overdreven claims ("de beste", "ongeëvenaard", "revolutionair")
- Schrijf alsof je een ervaren trader advies geeft aan een vriend
- Voeg licht kritische observaties toe — wees eerlijk over nadelen
- GEEN herhaling van punten die al in eerdere blokken staan

TOON: ${tone === 'neutral' ? 'Objectief en informatief, maar persoonlijk' : tone === 'opinionated' ? 'Mild opiniërend, eerlijk, direct' : 'Zakelijk en no-nonsense'}

FORMAT:
- Begin direct met de inhoud (GEEN heading — die wordt apart toegevoegd)
- Gebruik markdown formatting
- Als dit blok een vergelijkingstabel bevat, gebruik markdown tabel syntax
- Houd het blok tussen 100-250 woorden
${shouldInjectImage ? `- Voeg ergens halverwege het blok een afbeelding toe in markdown: ![${target_keyword} illustratie](https://placehold.co/800x400/1a1a2e/eab308?text=${encodeURIComponent(target_keyword)})` : ''}

AFFILIATE LINKS — BELANGRIJK:
- Voeg ALLEEN een affiliate link toe als het ECHT logisch past in de context
- Bijvoorbeeld: na een directe aanbeveling, of wanneer je een platform specifiek bespreekt als oplossing
- De meeste blokken hebben GEEN affiliate link nodig — dat is prima
- Als je er een toevoegt, gebruik een contextual anchor: bijvoorbeeld [Bekijk BitMEX](/go/bitmex)
- NOOIT "klik hier" of geforceerde doorverwijzingen
- NOOIT meer dan 1 link per blok
- Het is BETER om geen link te plaatsen dan een geforceerde link`;

        const contextSummary = previous_blocks.length > 0
            ? `\n\nEERDER GESCHREVEN BLOKKEN (vermijd herhaling):\n${previous_blocks.map((b: any) => `[${b.block_id}]: ${b.content.substring(0, 200)}...`).join('\n')}`
            : '';

        const userPrompt = `ARTIKEL: "${outline.title}"
KEYWORD: "${target_keyword}"
INVALSHOEK: ${outline.article_angle || 'Eerlijke vergelijking'}
DOELGROEP: ${outline.target_user || 'Nederlandse crypto traders'}

DIT BLOK: ${block_label}
INSTRUCTIE: ${block_description}
HEADING VOOR DIT BLOK: ${heading}

${platformData.length > 0 ? `
PLATFORMDATA:
${platformData.map((p) => `
${p.name} (${p.slug}):
- Opgericht: ${p.founded} | Max leverage: ${p.maxLeverage}
- Maker: ${p.makerFee} | Taker: ${p.takerFee}
- Pairs: ${p.tradingPairs}
- Pros: ${p.pros.join('; ')}
- Cons: ${p.cons.join('; ')}
- Best voor: ${p.bestFor}
`).join('\n')}` : ''}

BESCHIKBARE AFFILIATE LINKS: ${[
                ...affiliates.map((a) => `${a.name} → /go/${a.slug}`),
                ...platformData.filter(p => p.affiliateLink).map((p) => `${p.name} → /go/${p.slug}`)
            ].join(', ')}
${contextSummary}

Schrijf nu het blok "${block_label}". Begin direct met de tekst, geen heading.`;

        const result = await generateText({
            model: model_provider === 'gemini' ? google('gemini-2.5-flash') : openai('gpt-5-mini'),
            system: systemPrompt,
            prompt: userPrompt,
            maxTokens: 800,
        });

        return new Response(JSON.stringify({
            block_id,
            heading,
            content: result.text,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error('Block generation error:', error);
        return new Response(JSON.stringify({
            error: 'Er ging iets mis bij het genereren van het blok.',
            details: error?.message || 'Unknown error',
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
