/**
 * VisualInspectorAgent — final quality gate before publishing.
 *
 * Responsibilities:
 *  - Verify image alt text presence and relevance to section headers
 *  - Check paragraph lengths (no single paragraph > 200 words)
 *  - Validate CTA placement (intro + mid + conclusion)
 *  - Ensure affiliate disclosure is present
 *  - Verify FAQ schema markup
 *  - Validate metadata (meta_title ≤ 60 chars, meta_description ≤ 155 chars)
 *  - Detect formatting anomalies (double headings, empty sections, broken markdown)
 *  - Route revision actions to specific agents (writer, image_generator, seo)
 *
 * Uses claude-3-5-sonnet for strong reasoning on quality judgement.
 * Max 3 inspection loops before escalation.
 */

import { z } from 'zod';
import { BaseAgent } from './base.ts';
import type {
    AgentRecord,
    ArticleWithImages,
    InspectionResult,
    RevisionAction,
} from './types.ts';

const inspectionOutputSchema = z.object({
    status: z.enum(['APPROVED', 'REVISE']),
    actions: z.array(z.object({
        target: z.enum(['writer', 'image_generator', 'seo']),
        issue: z.string(),
        section: z.string().optional(),
    })),
    summary: z.string(),
});

export class VisualInspectorAgent extends BaseAgent {
    constructor(record: AgentRecord) {
        super(record);
    }

    async run(article: ArticleWithImages): Promise<InspectionResult> {
        // Build a structured representation of the article for inspection
        const articleInfo = {
            title: article.title,
            slug: article.slug,
            meta_title: article.meta_title,
            meta_description: article.meta_description,
            word_count: article.word_count,
            keyword: article.primary_keyword,
            keyword_density: article.keyword_density,
            faq_schema_added: article.faq_schema_added,
            faq_items_count: article.faq_items?.length ?? 0,
            hero_image: article.hero_image_url ? 'present' : 'missing',
            body_images_count: article.body_images_data?.length ?? 0,
            body_images: article.body_images_data?.map(img => ({
                alt: img.alt,
                section: img.section_heading,
                has_url: !!img.url,
            })) ?? [],
            cta_blocks: article.cta_blocks,
        };

        // Pre-check: run deterministic quality checks before sending to LLM
        const deterministicIssues: RevisionAction[] = [];

        // Meta title check
        if (article.meta_title && article.meta_title.length > 60) {
            deterministicIssues.push({
                target: 'seo',
                issue: `Meta title is ${article.meta_title.length} chars (max 60)`,
            });
        }

        // Meta description check
        if (article.meta_description && article.meta_description.length > 155) {
            deterministicIssues.push({
                target: 'seo',
                issue: `Meta description is ${article.meta_description.length} chars (max 155)`,
            });
        }

        // Hero image check
        if (!article.hero_image_url) {
            deterministicIssues.push({
                target: 'image_generator',
                issue: 'Hero image is missing',
            });
        }

        // Body images check
        if ((article.body_images_data?.length ?? 0) === 0) {
            deterministicIssues.push({
                target: 'image_generator',
                issue: 'No body images present — articles should have 1-2 contextual images',
            });
        }

        // Alt text check
        const missingAlt = article.body_images_data?.filter(img => !img.alt || img.alt.trim().length < 5) ?? [];
        if (missingAlt.length > 0) {
            deterministicIssues.push({
                target: 'image_generator',
                issue: `${missingAlt.length} body image(s) missing proper alt text`,
            });
        }

        // CTA placement check
        const ctaPositions = new Set(article.cta_blocks?.map(c => c.position) ?? []);
        if (!ctaPositions.has('conclusion')) {
            deterministicIssues.push({
                target: 'writer',
                issue: 'No CTA in conclusion section',
            });
        }

        // FAQ schema check
        if (!article.faq_schema_added) {
            deterministicIssues.push({
                target: 'seo',
                issue: 'FAQ schema markup is missing',
            });
        }

        // Paragraph length check (detect long paragraphs)
        const paragraphs = article.article_markdown.split(/\n\n+/);
        const longParagraphs = paragraphs.filter(p => {
            // Skip headings, lists, tables, images
            if (p.trim().startsWith('#') || p.trim().startsWith('-') || p.trim().startsWith('|') || p.trim().startsWith('!')) return false;
            const wordCount = p.split(/\s+/).length;
            return wordCount > 200;
        });
        if (longParagraphs.length > 0) {
            deterministicIssues.push({
                target: 'writer',
                issue: `${longParagraphs.length} paragraph(s) exceed 200 words — split for readability`,
            });
        }

        // Affiliate disclosure check
        const hasDisclosure = article.article_markdown.toLowerCase().includes('affiliate') ||
            article.article_markdown.toLowerCase().includes('commissie') ||
            article.article_markdown.toLowerCase().includes('partnerlink');
        if (!hasDisclosure && article.cta_blocks && article.cta_blocks.length > 0) {
            deterministicIssues.push({
                target: 'writer',
                issue: 'Article contains affiliate links but no affiliate disclosure',
            });
        }

        // Now run LLM-based inspection for subjective quality checks
        const result = await this.callObject({
            schema: inspectionOutputSchema,
            model: 'anthropic:claude-3-5-sonnet-20241022',
            maxTokens: 2000,
            timeoutMs: 60000,
            systemPrompt: `Je bent de Visuele Inspecteur voor ShortNews, een Belgische crypto blog.

TAAK: Voer een laatste kwaliteitscontrole uit op het artikel voordat het gepubliceerd wordt.

DETERMINISTISCHE CHECKS REEDS UITGEVOERD (deze hoef je NIET opnieuw te controleren):
${deterministicIssues.length > 0 ? deterministicIssues.map(i => `- [${i.target}] ${i.issue}`).join('\n') : '- Alle checks zijn geslaagd'}

JIJ CONTROLEERT OP:
1. Logische structuur: intro → body → conclusie → FAQ volgorde correct?
2. Leesbaarheid: geen zinnen langer dan 40 woorden, alinea's variëren in lengte
3. Inhoudelijke consistentie: titel belooft wat het artikel levert
4. Dubbele koppen of lege secties
5. Gebroken markdown (niet-gesloten vet, links, tabellen)
6. Afbeelding-relevantie: alt teksten matchen met sectie-inhoud
7. Keyword stuffing: voelt de keyword-plaatsing natuurlijk aan?

REGELS:
- Als alles correct is: status = "APPROVED", actions = []
- Als er problemen zijn: status = "REVISE", specificeer per actie de target agent
- Wees streng maar eerlijk — minor issues (info-level) leiden NIET tot REVISE
- Alleen serieuze kwaliteitsproblemen rechtvaardigen een REVISE

TARGET AGENTS:
- "writer": structuur, paragrafen, leesbaarheid, inhoud
- "image_generator": afbeeldingen, alt text, visuele kwaliteit
- "seo": metadata, schema, keyword plaatsing`,
            userPrompt: `ARTIKEL INFORMATIE:
${JSON.stringify(articleInfo, null, 2)}

EERSTE 3000 TEKENS VAN HET ARTIKEL:
${article.article_markdown.substring(0, 3000)}

LAATSTE 1500 TEKENS:
${article.article_markdown.substring(Math.max(0, article.article_markdown.length - 1500))}

Beoordeel de kwaliteit en geef je inspectieresultaat.`,
        });

        // Merge deterministic issues with LLM-discovered issues
        const allActions: RevisionAction[] = [...deterministicIssues, ...result.actions];

        // Determine final status
        const finalStatus = allActions.length > 0 ? 'REVISE' as const : result.status;

        await this.log({
            articleId: null,
            stage: 'visual_inspector:check',
            inputSummary: {
                title: article.title,
                keyword: article.primary_keyword,
                word_count: article.word_count,
                hero_image: !!article.hero_image_url,
                body_images: article.body_images_data?.length ?? 0,
            },
            decisionSummary: {
                status: finalStatus,
                deterministic_issues: deterministicIssues.length,
                llm_issues: result.actions.length,
                total_actions: allActions.length,
                action_targets: allActions.map(a => a.target),
            },
            reasoningSummary: `${finalStatus}: ${result.summary}. ${deterministicIssues.length} deterministic + ${result.actions.length} LLM-detected issues.`,
        });

        return {
            status: finalStatus,
            actions: allActions,
            summary: result.summary,
        };
    }
}
