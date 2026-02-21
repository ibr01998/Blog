/**
 * SEOAgent — optimizes articles for Dutch search engine ranking.
 *
 * Responsibilities:
 *  - Ensure keyword appears in H1, first 100 words, at least one H2, last paragraph
 *  - Target keyword density 0.8%-1.5% (configurable via behavior_overrides)
 *  - Generate optimized meta_title (max 60 chars)
 *  - Add FAQ JSON-LD schema as HTML comment if FAQ section exists
 *  - Log all changes applied
 */

import { z } from 'zod';
import { BaseAgent } from './base.ts';
import type { AgentRecord, ArticleFactChecked, ArticleOptimized } from './types.ts';

const seoOutputSchema = z.object({
  optimized_markdown: z.string().min(500),
  meta_title: z.string().max(65),
  keyword_density: z.number().min(0).max(0.05),
  faq_schema_added: z.boolean(),
  faq_items: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })).default([]),
  changes_made: z.array(z.string()),
});

export class SEOAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  async run(article: ArticleFactChecked): Promise<ArticleOptimized> {
    const targetDensity = ((this.mergedConfig as any).keyword_density_target as number | undefined) ?? 0.011;
    const minDensity = 0.008; // 0.8%
    const maxDensity = 0.015; // 1.5%

    const result = await this.callObject({
      schema: seoOutputSchema,
      model: 'gpt-4o-mini',
      maxTokens: 4000,
      timeoutMs: 90000, // 90s timeout for SEO (processes full articles)
      systemPrompt: this.buildSystemPrompt(targetDensity),
      userPrompt: `
Optimaliseer het volgende artikel voor Nederlandse zoekmachines.

PRIMAIRE KEYWORD: "${article.primary_keyword}"
HUIDIGE TITEL: "${article.title}"
META BESCHRIJVING: "${article.meta_description}"

ARTIKEL MARKDOWN:
${article.article_markdown}

OPTIMALISATIEVEREISTEN:
1. Zorg dat het primaire keyword voorkomt in:
   - De H1 titel (of vrijwel direct erna)
   - De eerste 100 woorden
   - Minstens één H2 koptekst
   - De laatste alinea of conclusie
2. Streef naar ${(targetDensity * 100).toFixed(1)}% keyword dichtheid (min ${(minDensity * 100).toFixed(1)}%, max ${(maxDensity * 100).toFixed(1)}%)
3. Gebruik LSI-termen en verwante keywords waar het natuurlijk aanvoelt
4. Meta_title: max 60 tekens, bevat het primaire keyword, is klikbaar
5. Als er een FAQ-sectie is, voeg onderaan toe: <!-- FAQ_SCHEMA: {"@type":"FAQPage","mainEntity":[...]} -->
6. Verbeter H2/H3 koppen zodat ze keyword-gerelateerd zijn maar niet overvol
7. Extraheer alle FAQ vragen en antwoorden als gestructureerde faq_items array (voor JSON-LD schema)

NIET DOEN:
- Keyword stuffing (dichtheid > 1.5% is een mislukking)
- Affiliate links wijzigen
- Feitelijke inhoud veranderen
- Sectievolgorde aanpassen

Geef terug: de volledige geoptimaliseerde markdown + meta_title + bereikte dichtheid + of FAQ schema is toegevoegd + faq_items (gestructureerde vragen/antwoorden) + lijst met aangebrachte wijzigingen.
`,
    });

    await this.log({
      articleId: null,
      stage: 'seo:optimized',
      inputSummary: {
        keyword: article.primary_keyword,
        title: article.title,
        word_count: article.word_count,
      },
      decisionSummary: {
        keyword_density: result.keyword_density,
        faq_schema: result.faq_schema_added,
        meta_title: result.meta_title,
        changes_count: result.changes_made.length,
        changes: result.changes_made,
      },
      reasoningSummary: `SEO pass complete for "${article.primary_keyword}". Density: ${(result.keyword_density * 100).toFixed(2)}% (target: ${(targetDensity * 100).toFixed(1)}%). FAQ schema: ${result.faq_schema_added}. Changes: ${result.changes_made.join(', ')}.`,
    });

    return {
      ...article,
      article_markdown: result.optimized_markdown,
      meta_title: result.meta_title,
      keyword_density: result.keyword_density,
      faq_schema_added: result.faq_schema_added,
      faq_items: result.faq_items ?? [],
      seo_changes: result.changes_made,
    };
  }

  private buildSystemPrompt(targetDensity: number): string {
    return `Je bent een SEO-specialist voor ShortNews, een Nederlandse crypto affiliateblog.

TAAK: Optimaliseer het artikel voor Nederlandse Google-zoekopdrachten.

TECHNISCHE SEO-REGELS:
- Keyword dichtheid: streef naar ${(targetDensity * 100).toFixed(1)}% (absoluut max 1.5%)
- H1 moet het primaire keyword bevatten (of direct erna in eerste zin)
- Eerste 100 woorden: primaire keyword exact of variant
- Minstens één H2 met het keyword of een directe variant
- Laatste alinea/conclusie: keyword herhalen
- Alt-tekst voor afbeeldingen als ze er zijn

CONTENT SEO:
- Verwerk semantisch gerelateerde termen (LSI keywords)
- Zorg voor logische interne structuur: intro → body → conclusie → FAQ
- FAQ-sectie is goed voor featured snippets
- Meta title: exact 50-60 tekens, actiegericht, keyword voorop

KWALITEITSSTANDAARD:
- NL/BE zoekintenties: "vergelijken", "review", "ervaringen", "kosten"
- Nederlandse Google ranking factors zijn gelijkaardig aan globale
- Keyword stuffing detecteer je zelf — boven 1.5% geef je dit aan in changes_made

GEEF TERUG:
- optimized_markdown: het volledige geoptimaliseerde artikel
- meta_title: max 60 tekens
- keyword_density: werkelijk berekende dichtheid als decimaal (0.011 = 1.1%)
- faq_schema_added: true als je FAQ JSON-LD schema hebt toegevoegd
- faq_items: array van {question, answer} objecten — extraheer alle FAQ vragen uit het artikel
- changes_made: lijst van specifieke aanpassingen`;
  }
}
