/**
 * WriterAgent — produces full article drafts from editorial assignments.
 *
 * Single agent class handles all 3 writer subtypes at runtime:
 *  - Conversion Closer (money tier) — confident, CTA-focused, drives affiliate clicks
 *  - Authority Builder (authority tier) — educational, data-driven, builds trust
 *  - Insider (trend tier) — opinionated, timely, crypto-native voice
 *
 * Subtype is selected from assignment.brief.content_tier — NOT from DB role.
 * Only ONE writer agent row needed in the agents table.
 */

import { z } from 'zod';
import { BaseAgent } from './base.ts';
import type {
  AgentRecord,
  ArticleAssignment,
  ArticleDraft,
  ContentTier,
} from './types.ts';
import { getActiveAffiliates } from '../../data/affiliates.ts';

// Writer subtype persona definitions
const WRITER_SUBTYPES: Record<ContentTier, {
  name: string;
  description: string;
  traits: string[];
}> = {
  money: {
    name: 'Conversion Closer',
    description: 'Writes confident, structured content designed to drive affiliate conversions.',
    traits: [
      'Direct and assertive — no hedging or vague language',
      'Clear benefit statements in every section',
      'Strategic CTA placement at high-intent moments',
      'Comparison tables that make the choice obvious',
      'Uses social proof and concrete numbers naturally',
      'Never uses "klik hier" — always contextual anchors',
    ],
  },
  authority: {
    name: 'Authority Builder',
    description: 'Writes educational, deeply analytical content that builds long-term trust.',
    traits: [
      'Data-driven — cite specific fees, percentages, and facts',
      'Balanced analysis — acknowledge platform limitations honestly',
      'Teach first, sell second — value before conversion',
      'Use technical terminology correctly (maker/taker, funding rate, liquidation)',
      'Deep-dive H2/H3 structure with clear logical flow',
      'At least 3 genuine drawbacks per platform reviewed',
    ],
  },
  trend: {
    name: 'Insider',
    description: 'Writes opinionated, timely content from a crypto-native perspective.',
    traits: [
      'First-person opinion when appropriate ("Eerlijk gezegd...")',
      'Reference current market context and recent developments',
      'Bold takes — not wishy-washy, not politically correct',
      'Conversational but knowledgeable Dutch tone',
      'Shorter, punchier paragraphs (max 3 sentences)',
      'Crypto insider vocabulary: on-chain, alpha, liquidated, GM',
    ],
  },
};

const draftSchema = z.object({
  title: z.string().min(10).max(80),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be lowercase with hyphens only'),
  meta_description: z.string().max(160),
  article_markdown: z.string().min(500),
  word_count: z.number().int(),
  internal_links: z.array(z.object({
    anchor: z.string(),
    href: z.string(),
  })),
  cta_blocks: z.array(z.object({
    position: z.enum(['intro', 'mid', 'conclusion']),
    platform: z.string(),
    anchor: z.string(),
  })).min(1).max(4),
  estimated_reading_time_minutes: z.number().int(),
});

export class WriterAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  async run(assignment: ArticleAssignment): Promise<ArticleDraft> {
    const { brief } = assignment;
    const subtype = WRITER_SUBTYPES[brief.content_tier];
    const affiliates = getActiveAffiliates();

    // Apply avoid_platform override — filter out blocked platforms
    const avoidPlatforms = (this.mergedConfig as any).avoid_platform as string[] | undefined;
    const availableAffiliates = avoidPlatforms?.length
      ? affiliates.filter((a) => !avoidPlatforms.includes(a.id))
      : affiliates;

    // Apply lower_wordcount override
    const targetWords = (this.mergedConfig as any).lower_wordcount
      ? Math.min(brief.target_word_count, 800)
      : brief.target_word_count;

    const draft = await this.callObject({
      schema: draftSchema,
      model: 'anthropic:claude-sonnet-4-5-20250929',
      systemPrompt: this.buildSystemPrompt(subtype, brief.content_tier),
      userPrompt: `
Schrijf een volledig Nederlands crypto artikel voor ShortNews.tech.

OPDRACHT:
- Primaire keyword: ${brief.primary_keyword}
- Voorgestelde titel: ${brief.title_suggestion}
- Format: ${brief.format_type}
- Hook type: ${brief.hook_type}
- Doelgroep: crypto traders in Nederland en België
- Streefaantal woorden: ${targetWords}
- Uitgelichte platformen: ${brief.target_platforms.join(', ')}
- Affiliate focus: ${brief.affiliate_focus}

BESCHIKBARE AFFILIATE LINKS (gebruik /go/{slug} paden):
${availableAffiliates.map((a) => `- ${a.name}: /go/${a.slug} — ${a.commission}`).join('\n')}

VEREISTEN VOOR article_markdown:
- Volledig artikel met alle H2/H3 koppen
- Begin met een sterke intro die direct de zoekvraag beantwoordt
- Verwerk affiliate links contextual (max 1 per sectie, gebruik meaning anchors)
- Voeg een FAQ-sectie toe met 3-5 relevante vragen
- Eindig met een duidelijke conclusie + aanbeveling

VEREISTEN VOOR slug:
- Volledig lowercase, alleen koppeltekens, Dutch keywords
- Voorbeeld: "bybit-review-2026-ervaringen"

VEREISTEN VOOR meta_description:
- Max 155 tekens
- Actiegericht, bevat het primaire keyword
- Nooit "In dit artikel..." als opening

VEREISTEN VOOR cta_blocks:
- 2-3 CTA placements: intro (na eerste sectie), mid, conclusion
- Platform = exchange naam (bijv. "Bybit")
- Anchor = een van de ctaAnchors uit het affiliate programma

ABSOLUTE REGELS:
- Verzin GEEN statistieken of fees — gebruik alleen feitelijke data
- Gebruik NOOIT "klik hier" als ankertekst
- Maximaal 1 affiliate link per sectie
- Alle content in het Nederlands
- Wees eerlijk over nadelen — geen pure promotie
`,
    });

    await this.log({
      articleId: null, // will be backfilled by orchestrator after DB insert
      stage: 'writer:draft',
      inputSummary: {
        keyword: brief.primary_keyword,
        tier: brief.content_tier,
        subtype: subtype.name,
        target_words: targetWords,
      },
      decisionSummary: {
        title: draft.title,
        slug: draft.slug,
        word_count: draft.word_count,
        cta_count: draft.cta_blocks.length,
        format: brief.format_type,
      },
      reasoningSummary: `Wrote ${draft.word_count} words as "${subtype.name}" for keyword "${brief.primary_keyword}". ${draft.cta_blocks.length} CTA placements: ${draft.cta_blocks.map((c) => c.position).join(', ')}.`,
    });

    return {
      assignment_id: assignment.assignment_id,
      title: draft.title,
      slug: draft.slug,
      meta_description: draft.meta_description,
      article_markdown: draft.article_markdown,
      word_count: draft.word_count,
      primary_keyword: brief.primary_keyword,
      internal_links: draft.internal_links,
      cta_blocks: draft.cta_blocks,
      estimated_reading_time_minutes: draft.estimated_reading_time_minutes,
    };
  }

  private buildSystemPrompt(
    subtype: typeof WRITER_SUBTYPES[ContentTier],
    tier: ContentTier
  ): string {
    const assertive = (this.mergedConfig as any).increase_assertiveness;
    const noHype = (this.mergedConfig as any).reduce_hype;

    return `Je bent "${subtype.name}", een gespecialiseerde schrijver voor ShortNews, een Nederlandse crypto affiliateblog.

PERSONA: ${subtype.description}

SCHRIJFSTIJL:
${subtype.traits.map((t) => `- ${t}`).join('\n')}

${assertive ? '- Wees assertiever en zelfverzekerder in aanbevelingen.' : ''}
${noHype ? '- Vermijd hypetaal. Geen superlatieven, geen uitroeptekens, geen overdrijving.' : ''}

BLOG CONTEXT:
- Taal: Nederlands (nl)
- Doelgroep: crypto traders in Nederland en België
- Website: ShortNews.tech
- Monetisatie: affiliate links via /go/{slug} paden
- Platformen: BitMEX, Bybit, Binance, Kraken

ABSOLUTE REGELS:
1. Verzin NOOIT statistieken, fees, of data — laat het weg als je het niet zeker weet
2. Gebruik NOOIT "klik hier" — gebruik altijd contextuele ankertekst
3. Maximaal 1 affiliate link per H2-sectie
4. Voeg altijd een eerlijk kritisch perspectief toe
5. Alle content volledig in het Nederlands
6. slug: alleen lowercase letters, cijfers en koppeltekens`;
  }
}
