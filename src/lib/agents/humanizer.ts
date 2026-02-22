/**
 * HumanizerAgent — post-processes AI-generated articles to sound more natural.
 *
 * Responsibilities:
 *  - Remove AI-like sentence patterns and opener clichés
 *  - Vary paragraph structure and sentence lengths
 *  - Add natural Dutch filler phrases for conversational flow
 *  - Keep affiliate links, headings, and factual data intact
 *  - Log changes applied to agent_logs
 */

import { BaseAgent } from './base.ts';
import type { AgentRecord, ArticleDraft, ArticleHumanized } from './types.ts';

export class HumanizerAgent extends BaseAgent {
  constructor(record: AgentRecord) {
    super(record);
  }

  async run(draft: ArticleDraft): Promise<ArticleHumanized> {
    const humanizedText = await this.callText({
      model: 'gpt-4o-mini',
      maxTokens: 6000,
      timeoutMs: 90000, // 90s timeout for Humanizer (processes full articles)
      systemPrompt: this.buildSystemPrompt(),
      userPrompt: draft.article_markdown,
    });

    // Detect what was changed via simple heuristics
    const changes: string[] = [];

    if (!humanizedText.includes('In dit artikel') && draft.article_markdown.includes('In dit artikel')) {
      changes.push('Removed "In dit artikel" AI opener');
    }
    if (!humanizedText.includes('Tot slot') && draft.article_markdown.includes('Tot slot')) {
      changes.push('Removed "Tot slot" cliché conclusion');
    }
    if (!humanizedText.includes('Laten we') && draft.article_markdown.includes('Laten we')) {
      changes.push('Removed "Laten we...verkennen" pattern');
    }
    if (Math.abs(humanizedText.length - draft.article_markdown.length) > 100) {
      changes.push('Paragraph restructuring applied');
    }
    if (humanizedText.includes('Eerlijk gezegd') || humanizedText.includes('Dat gezegd hebbende')) {
      changes.push('Natural Dutch filler phrases added');
    }
    if (changes.length === 0) {
      changes.push('Minor phrasing and flow improvements');
    }

    await this.log({
      articleId: null,
      stage: 'humanizer:pass',
      inputSummary: {
        title: draft.title,
        word_count: draft.word_count,
        input_length: draft.article_markdown.length,
      },
      decisionSummary: {
        output_length: humanizedText.length,
        changes_count: changes.length,
        changes: changes,
      },
      reasoningSummary: `Humanized "${draft.title}". Applied ${changes.length} change(s): ${changes.join(', ')}.`,
    });

    return {
      ...draft,
      article_markdown: humanizedText,
      humanization_changes: changes,
    };
  }

  private buildSystemPrompt(): string {
    return `Je bent een humanizer-editor voor ShortNews, een Belgische crypto blog met internationale focus.

TAAK: Herschrijf de onderstaande AI-gegenereerde tekst zodat het klinkt alsof een echte Belgische of internationale crypto lezer het heeft geschreven.

WAT JE MOET VERANDEREN:
- Vervang herhaalde zinsstarters door varianten: "Daarnaast" → "Bovendien", "Ook", "Verder"
- Splits alinea's van meer dan 4 zinnen op in kortere stukken
- Verwijder generieke AI-frasen:
  * "Het is belangrijk om..." → concreter formuleren
  * "In de huidige markt..." → weglaten of specifieker maken
  * "Een van de beste..." → vermijden als het niet concreet is
- Voeg 1-2 natuurlijke Nederlandstalige uitdrukkingen per sectie toe:
  * "Eerlijk gezegd...", "Dat gezegd hebbende...", "Nou ja..."
- Varieer alineagrootte — mix van 1-zin alinea's en 3-zin alinea's
- Verwijder overmatig gebruik van em-dash (—) — vervang door komma of nieuwe zin

WAT JE NIET MAG VERANDEREN:
- Affiliate links en hun ankerteksten (behoud /go/... links)
- Feitelijke data, fees, percentages, of cijfers
- H2/H3 koppen
- De volgorde van secties
- FAQ-inhoud (vragen en antwoorden)

VERBODEN AI-PATRONEN (verwijder deze):
- "In dit artikel gaan we..."
- "Laten we ... verkennen"
- "Tot slot willen we..."
- "Samenvattend kunnen we stellen..."
- Meervoudige uitroeptekens
- "Geweldig!", "Fantastisch!"

SKIMBAARHEIDSVEREISTEN:
- Verwijder alle herhaling en opvulling — elke zin moet informatie toevoegen
- Eerste zin van elke sectie = kernconclusie (omgekeerde piramide)
- Gebruik **vet** voor kernbegrippen en bedragen zodat scanners ze zien
- Verwijder zinnen als "Het is vermeldenswaard dat..." of "Het valt op dat..."
- Als een alinea hetzelfde punt herhaalt als de vorige: samenvoegen of verwijderen
- Streef naar 10-15% reductie in woordaantal zonder informatieverlies

GEEF ALLEEN DE VERBETERDE MARKDOWN TERUG — geen uitleg, geen commentaar.`;
  }
}
