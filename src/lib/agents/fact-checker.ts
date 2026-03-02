/**
 * FactCheckerAgent — verifies factual claims in articles before SEO optimization.
 *
 * Responsibilities:
 *  - Validate claims against platforms.ts ground truth data
 *  - Flag incorrect fees, leverage limits, founding years
 *  - Mark unverifiable statistics and outdated information
 *  - Assign severity levels: error (wrong), warning (unverifiable), info (vague)
 *  - Suggest action per issue: rewrite, generalize, or remove
 *  - Support fragment-level recheck after writer fixes (max 3 retry loops)
 */

import { z } from 'zod';
import { BaseAgent } from './base.ts';
import { platforms } from '../../data/platforms.ts';
import type {
  AgentRecord,
  ArticleHumanized,
  ArticleFactChecked,
  FactCheckIssue,
} from './types.ts';

const factCheckOutputSchema = z.object({
  issues: z.array(z.object({
    claim: z.string(),
    section: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    issue: z.string(),
    suggestion: z.string(),
    source: z.enum(['platforms_data', 'outdated', 'unverifiable', 'contradicted']),
    action: z.enum(['rewrite', 'generalize', 'remove']),
  })),
  overall_status: z.enum(['passed', 'flagged']),
  summary: z.string(),
});

// Same schema but for fragment-level recheck (only checks specific fragments)
const fragmentRecheckSchema = z.object({
  issues: z.array(z.object({
    claim: z.string(),
    section: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    issue: z.string(),
    suggestion: z.string(),
    source: z.enum(['platforms_data', 'outdated', 'unverifiable', 'contradicted']),
    action: z.enum(['rewrite', 'generalize', 'remove']),
  })),
  overall_status: z.enum(['passed', 'flagged']),
  summary: z.string(),
});

export class FactCheckerAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  /**
   * Full article fact-check — checks all claims in the article.
   */
  async run(article: ArticleHumanized): Promise<ArticleFactChecked> {
    // Build reference data context from platforms.ts (source of truth)
    const platformData = platforms.map(p => ({
      name: p.name,
      slug: p.slug,
      founded: p.founded,
      headquarters: p.headquarters,
      maxLeverage: p.maxLeverage,
      makerFee: p.makerFee,
      takerFee: p.takerFee,
      tradingPairs: p.tradingPairs,
      proofOfReserves: p.proofOfReserves,
      copyTrading: p.copyTrading,
      features: p.features,
    }));

    const result = await this.callObject({
      schema: factCheckOutputSchema,
      model: 'gpt-4o-mini',
      maxTokens: 2000,
      timeoutMs: 45000,
      systemPrompt: this.buildSystemPrompt(platformData),
      userPrompt: `Controleer het volgende artikel:

TITEL: "${article.title}"
KEYWORD: "${article.primary_keyword}"

ARTIKEL:
${article.article_markdown}`,
    });

    await this.log({
      articleId: null,
      stage: 'fact_checker:check',
      inputSummary: {
        title: article.title,
        keyword: article.primary_keyword,
        word_count: article.word_count,
      },
      decisionSummary: {
        status: result.overall_status,
        issue_count: result.issues.length,
        error_count: result.issues.filter(i => i.severity === 'error').length,
        warning_count: result.issues.filter(i => i.severity === 'warning').length,
        info_count: result.issues.filter(i => i.severity === 'info').length,
      },
      reasoningSummary: result.summary,
    });

    return {
      ...article,
      fact_check_status: result.overall_status,
      fact_check_issues: result.issues as FactCheckIssue[],
    };
  }

  /**
   * Fragment-level recheck — only verifies the specific fragments that were
   * previously flagged and rewritten. This is used in the retry loop after
   * the writer fixes flagged fragments.
   *
   * Cost-efficient: only sends the modified fragments + surrounding context,
   * not the entire article.
   */
  async recheckFragments(
    modifiedFragments: string[],
    fullArticle: string,
    title: string,
    keyword: string,
  ): Promise<{ issues: FactCheckIssue[]; status: 'passed' | 'flagged' }> {
    const platformData = platforms.map(p => ({
      name: p.name,
      slug: p.slug,
      founded: p.founded,
      headquarters: p.headquarters,
      maxLeverage: p.maxLeverage,
      makerFee: p.makerFee,
      takerFee: p.takerFee,
      tradingPairs: p.tradingPairs,
      proofOfReserves: p.proofOfReserves,
      copyTrading: p.copyTrading,
      features: p.features,
    }));

    const fragmentsText = modifiedFragments
      .map((f, i) => `FRAGMENT ${i + 1}:\n${f}`)
      .join('\n\n---\n\n');

    const result = await this.callObject({
      schema: fragmentRecheckSchema,
      model: 'gpt-4o-mini',
      maxTokens: 1500,
      timeoutMs: 30000,
      systemPrompt: this.buildSystemPrompt(platformData),
      userPrompt: `Controleer ALLEEN de volgende herschreven fragmenten op feitelijke juistheid.
Context: Deze fragmenten komen uit het artikel "${title}" (keyword: "${keyword}").

${fragmentsText}

VOLLEDIG ARTIKEL (voor context):
${fullArticle}`,
    });

    await this.log({
      articleId: null,
      stage: 'fact_checker:recheck_fragments',
      inputSummary: {
        title,
        keyword,
        fragment_count: modifiedFragments.length,
      },
      decisionSummary: {
        status: result.overall_status,
        remaining_issues: result.issues.length,
      },
      reasoningSummary: result.summary,
    });

    return {
      issues: result.issues as FactCheckIssue[],
      status: result.overall_status,
    };
  }

  private buildSystemPrompt(platformData: Record<string, unknown>[]): string {
    return `Je bent een factchecker voor ShortNews, een Belgische crypto blog met internationale focus.

TAAK: Controleer ALLE feitelijke claims tegen de meegeleverde referentiedata.

REFERENTIEDATA (bron van waarheid):
${JSON.stringify(platformData, null, 2)}

CONTROLEER OP:
1. Onjuiste fees (maker/taker percentages)
2. Onjuiste leverage limieten
3. Onjuiste oprichtingsjaren of hoofdkantoren
4. Claims over features die niet in de referentiedata staan
5. Verzonnen statistieken of percentages zonder bron
6. Verouderde informatie

SEVERITY REGELS:
- error: Feitelijk onjuist t.o.v. referentiedata (verkeerde fee, verkeerd jaar, verkeerde limiet)
- warning: Niet verifieerbaar vanuit referentiedata, maar potentieel onjuist
- info: Vaag genoeg om correct te zijn, maar kan preciezer

ACTION REGELS:
- rewrite: De claim moet herschreven worden met correcte data
- generalize: Verwijder specifieke (foute) details, maak de bewering vager
- remove: De claim is onherstelbaarbaar fout, verwijder de hele zin

OVERALL STATUS:
- "passed": Geen errors EN minder dan 3 warnings
- "flagged": Minstens 1 error OF 3+ warnings`;
  }
}
