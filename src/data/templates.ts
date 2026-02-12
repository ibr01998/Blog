/**
 * Article Templates by Intent Type
 * Each template defines the structure, required blocks, and CTA placement rules.
 * Used by the outline generator to adapt structure to search intent.
 */

export type ArticleIntent = 'comparison' | 'review' | 'bonus' | 'trust' | 'fee';

export interface ArticleBlock {
    id: string;
    label: string; // human-readable name
    description: string; // instruction for what this block covers
    required: boolean;
}

export interface ArticleTemplate {
    intent: ArticleIntent;
    label: string;
    description: string; // Dutch description for dashboard
    headingStructure: string[]; // example H2 headings
    blocks: ArticleBlock[];
    ctaPlacements: number[]; // indices of blocks after which CTAs appear
    schemaType: 'BlogPosting' | 'Review' | 'FAQPage';
    keywordPatterns: string[]; // patterns to match for auto-classification
}

export const articleTemplates: ArticleTemplate[] = [
    {
        intent: 'comparison',
        label: 'Vergelijking',
        description: 'Twee of meer platformen naast elkaar vergelijken',
        headingStructure: [
            'Introductie',
            '{Platform A} — Overzicht',
            '{Platform B} — Overzicht',
            'Vergelijking: {A} vs {B}',
            'Wanneer kies je {A}?',
            'Wanneer kies je {B}?',
            'Tips voor verantwoord handelen',
            'Veelgestelde vragen',
            'Conclusie',
        ],
        blocks: [
            { id: 'intro', label: 'Introductie', description: 'Directe beantwoording van de zoekvraag. Waarom deze vergelijking relevant is voor NL/BE traders.', required: true },
            { id: 'platform_a', label: 'Platform A — Overzicht', description: 'Sterke punten en aandachtspunten van het eerste platform. Gebruik feitelijke data uit het platform-register.', required: true },
            { id: 'platform_b', label: 'Platform B — Overzicht', description: 'Sterke punten en aandachtspunten van het tweede platform.', required: true },
            { id: 'comparison_table', label: 'Vergelijkingstabel', description: 'Overzichtelijke tabel met kerngegevens: fees, leverage, pairs, features.', required: true },
            { id: 'when_choose_a', label: 'Wanneer kies je A?', description: 'Specifiek profiel van de trader waarvoor platform A de beste keuze is.', required: true },
            { id: 'when_choose_b', label: 'Wanneer kies je B?', description: 'Specifiek profiel van de trader waarvoor platform B de beste keuze is.', required: true },
            { id: 'tips', label: 'Tips', description: 'Verantwoord handelen tips. Concreet en actionable, niet generiek.', required: false },
            { id: 'faq', label: 'FAQ', description: '3-5 veelgestelde vragen relevant voor de zoekopdracht. Korte, directe antwoorden.', required: true },
            { id: 'conclusion', label: 'Conclusie', description: 'Samenvatting zonder herhaling. Eindig met duidelijke aanbeveling op basis van traderprofiel.', required: true },
        ],
        ctaPlacements: [1, 2, 8], // after platform_a, platform_b, conclusion
        schemaType: 'BlogPosting',
        keywordPatterns: ['vs', 'vergelijking', 'vergelijken', 'verschil', 'of'],
    },
    {
        intent: 'review',
        label: 'Review',
        description: 'Diepgaande review van één platform',
        headingStructure: [
            'Introductie',
            'Wat is {Platform}?',
            'Onze ervaring met {Platform}',
            'Fees en kosten',
            'Veiligheid en betrouwbaarheid',
            'Voor- en nadelen',
            'Voor wie geschikt?',
            'Veelgestelde vragen',
            'Conclusie',
        ],
        blocks: [
            { id: 'intro', label: 'Introductie', description: 'Korte samenvatting van het platform en waarom je deze review leest.', required: true },
            { id: 'what_is', label: 'Wat is dit platform?', description: 'Achtergrond, oprichting, marktpositie. Feitelijk, niet promotioneel.', required: true },
            { id: 'experience', label: 'Onze ervaring', description: 'Persoonlijk getinte review van het daadwerkelijk gebruiken van het platform.', required: true },
            { id: 'fees', label: 'Fees en kosten', description: 'Gedetailleerd kostenoverzicht met vergelijking ten opzichte van marktgemiddelde.', required: true },
            { id: 'security', label: 'Veiligheid', description: 'Beveiligingsmaatregelen, trackrecord, licenties, Proof of Reserves.', required: true },
            { id: 'pros_cons', label: 'Voor- en nadelen', description: 'Eerlijke opsomming. Minimaal 3 nadelen.', required: true },
            { id: 'best_for', label: 'Voor wie geschikt?', description: 'Doelgroepbeschrijving: beginner vs gevorderd, volume, doelen.', required: true },
            { id: 'faq', label: 'FAQ', description: '3-5 veelgestelde vragen specifiek voor dit platform.', required: true },
            { id: 'conclusion', label: 'Conclusie', description: 'Onze eerlijke mening in 2-3 zinnen. Geen overdreven lof.', required: true },
        ],
        ctaPlacements: [2, 5, 8],
        schemaType: 'Review',
        keywordPatterns: ['review', 'ervaring', 'ervaringen', 'betrouwbaar', 'goed'],
    },
    {
        intent: 'bonus',
        label: 'Bonus / Promotie',
        description: 'Artikel over een specifieke aanbieding of welkomstbonus',
        headingStructure: [
            'Introductie',
            'Wat is de {Platform} bonus?',
            'Hoe claim je de bonus?',
            'Voorwaarden',
            'Is het de moeite waard?',
            'Veelgestelde vragen',
            'Conclusie',
        ],
        blocks: [
            { id: 'intro', label: 'Introductie', description: 'Direct antwoord: wat is de bonus en hoe hoog.', required: true },
            { id: 'bonus_detail', label: 'Bonusdetails', description: 'Exacte details van de promotie. Bedragen, looptijden, beperkingen.', required: true },
            { id: 'how_to', label: 'Hoe claim je de bonus?', description: 'Stap-voor-stap uitleg. Concreet en direct.', required: true },
            { id: 'conditions', label: 'Voorwaarden', description: 'Eerlijke bespreking van de voorwaarden. Eventuele valkuilen benoemen.', required: true },
            { id: 'worth_it', label: 'Is het de moeite waard?', description: 'Eerlijke analyse. Wanneer is het zinvol, wanneer niet?', required: true },
            { id: 'faq', label: 'FAQ', description: '3-4 veelgestelde vragen over de bonus.', required: true },
            { id: 'conclusion', label: 'Conclusie', description: 'Eerlijk advies zonder druk.', required: true },
        ],
        ctaPlacements: [0, 2, 6],
        schemaType: 'BlogPosting',
        keywordPatterns: ['bonus', 'promotie', 'aanbieding', 'korting', 'welkomst', 'gratis'],
    },
    {
        intent: 'trust',
        label: 'Vertrouwen & Veiligheid',
        description: 'Artikel over betrouwbaarheid, veiligheid, of legaliteit',
        headingStructure: [
            'Introductie',
            'Is {Platform} betrouwbaar?',
            'Veiligheidsmaatregelen',
            'Regulering en licenties',
            'Onze beoordeling',
            'Veelgestelde vragen',
            'Conclusie',
        ],
        blocks: [
            { id: 'intro', label: 'Introductie', description: 'Direct antwoord op de vertrouwensvraag.', required: true },
            { id: 'trustworthy', label: 'Betrouwbaarheid', description: 'Feitelijke analyse: leeftijd, trackrecord, incidenten, volume.', required: true },
            { id: 'security', label: 'Veiligheidsmaatregelen', description: '2FA, cold storage, insurance fund, bug bounty.', required: true },
            { id: 'regulation', label: 'Regulering', description: 'Licenties, juridische positie in NL/BE, AFM-status.', required: true },
            { id: 'assessment', label: 'Onze beoordeling', description: 'Eerlijke inschatting. Sterke en zwakke punten op vertrouwensgebied.', required: true },
            { id: 'faq', label: 'FAQ', description: '3-5 vragen over veiligheid en betrouwbaarheid.', required: true },
            { id: 'conclusion', label: 'Conclusie', description: 'Ons advies. Eerlijk en evenwichtig.', required: true },
        ],
        ctaPlacements: [1, 4, 6],
        schemaType: 'BlogPosting',
        keywordPatterns: ['betrouwbaar', 'veilig', 'oplichting', 'scam', 'legaal', 'regulering'],
    },
    {
        intent: 'fee',
        label: 'Fees & Kosten',
        description: 'Artikel specifiek over kosten en fees',
        headingStructure: [
            'Introductie',
            'Fee-overzicht {Platform}',
            'Vergelijking met concurrenten',
            'Hoe bespaar je op fees?',
            'Veelgestelde vragen',
            'Conclusie',
        ],
        blocks: [
            { id: 'intro', label: 'Introductie', description: 'Direct antwoord: wat kost het platform? Korte samenvatting.', required: true },
            { id: 'fee_breakdown', label: 'Fee-overzicht', description: 'Gedetailleerde uitleg: maker/taker, withdrawals, funding rates, verborgen kosten.', required: true },
            { id: 'competitor_comparison', label: 'Vergelijking', description: 'Fees vergelijken met 2-3 concurrenten. Tabel met concrete cijfers.', required: true },
            { id: 'savings_tips', label: 'Hoe bespaar je?', description: 'Concrete tips: referral codes, VIP-levels, token-korting.', required: true },
            { id: 'faq', label: 'FAQ', description: '3-4 vragen specifiek over kosten.', required: true },
            { id: 'conclusion', label: 'Conclusie', description: 'Eerlijk oordeel: is dit platform duur of goedkoop?', required: true },
        ],
        ctaPlacements: [0, 3, 5],
        schemaType: 'BlogPosting',
        keywordPatterns: ['fees', 'kosten', 'commissie', 'goedkoop', 'duur', 'prijzen'],
    },
];

/** Auto-classify keyword into intent type */
export function classifyIntent(keyword: string): ArticleIntent {
    const lower = keyword.toLowerCase();
    for (const template of articleTemplates) {
        if (template.keywordPatterns.some((pattern) => lower.includes(pattern))) {
            return template.intent;
        }
    }
    return 'comparison'; // default
}

/** Get template by intent */
export function getTemplate(intent: ArticleIntent): ArticleTemplate {
    return articleTemplates.find((t) => t.intent === intent) || articleTemplates[0];
}
