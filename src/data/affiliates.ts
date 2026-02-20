/**
 * Affiliate Program Registry
 * Central source of truth for all affiliate link configurations.
 * Used by content generation and the /go/[id] redirect handler.
 */

export interface AffiliateProgram {
    id: string;
    name: string;
    slug: string; // cloaked URL path: /go/{slug}
    url: string; // actual affiliate URL (fallback if env var not set)
    envKey: string; // env var name for the real affiliate URL
    type: 'cpa' | 'revenue_share' | 'hybrid';
    commission: string; // human-readable commission info
    maxCtaPlacements: number;
    ctaAnchors: string[]; // suggested contextual anchor texts (Dutch)
    active: boolean;
}

export const affiliatePrograms: AffiliateProgram[] = [
    {
        id: 'bitmex',
        name: 'BitMEX',
        slug: 'bitmex',
        url: 'https://www.bitmex.com/app/register/PeDh7o',
        envKey: 'AFFILIATE_LINK_BITMEX',
        type: 'revenue_share',
        commission: '20% fee discount voor referred users',
        maxCtaPlacements: 4,
        ctaAnchors: [
            'Bekijk BitMEX',
            'Maak een BitMEX account aan',
            'Start met traden op BitMEX',
            'Probeer BitMEX zelf',
        ],
        active: true,
    },
    {
        id: 'bybit',
        name: 'Bybit',
        slug: 'bybit',
        url: 'https://www.bybit.eu/invite?ref=BW3PYWV',
        envKey: 'AFFILIATE_LINK_BYBIT',
        type: 'cpa',
        commission: 'Tot $30 CPA per verified user',
        maxCtaPlacements: 4,
        ctaAnchors: [
            'Bekijk Bybit',
            'Maak een Bybit account aan',
            'Ontdek Bybit',
            'Open een Bybit account',
        ],
        active: true,
    },
    {
        id: 'binance',
        name: 'Binance',
        slug: 'binance',
        url: 'https://www.binance.com/referral/earn-together/refer2earn-usdc/claim?hl=en&ref=GRO_28502_9B9D7&utm_source=default',
        envKey: 'AFFILIATE_LINK_BINANCE',
        type: 'revenue_share',
        commission: '20% kickback op trading fees',
        maxCtaPlacements: 4,
        ctaAnchors: [
            'Bekijk Binance',
            'Start op Binance',
            'Registreer bij Binance',
            'Open een Binance account',
        ],
        active: true,
    },
    {
        id: 'kraken',
        name: 'Kraken',
        slug: 'kraken',
        url: 'https://invite.kraken.com/JDNW/e6a2xq6x',
        envKey: 'AFFILIATE_LINK_KRAKEN',
        type: 'cpa',
        commission: 'Tot $10 CPA per trade',
        maxCtaPlacements: 3,
        ctaAnchors: [
            'Bekijk Kraken',
            'Maak een Kraken account',
            'Ontdek Kraken',
        ],
        active: true,
    },
    {
        id: 'amazon',
        name: 'Amazon Associates',
        slug: 'amazon',
        url: 'https://www.amazon.nl',
        envKey: 'AMAZON_PARTNER_TAG',
        type: 'revenue_share',
        commission: 'Tot 12% commissie op Amazon.nl verkopen',
        maxCtaPlacements: 3,
        ctaAnchors: [
            'Bekijk op Amazon',
            'Bekijk de huidige prijs',
            'Bestel via Amazon.nl',
            'Controleer beschikbaarheid',
        ],
        active: true,
    },
];

/** Get affiliate by id */
export function getAffiliate(id: string): AffiliateProgram | undefined {
    return affiliatePrograms.find((a) => a.id === id);
}

/** Get all active affiliates */
export function getActiveAffiliates(): AffiliateProgram[] {
    return affiliatePrograms.filter((a) => a.active);
}

/** Get redirect URL for an affiliate (checks env first, then fallback) */
export function getAffiliateUrl(id: string): string | null {
    const aff = getAffiliate(id);
    if (!aff) return null;
    // In Astro server context, import.meta.env is available
    const envUrl = (import.meta as any).env?.[aff.envKey];
    return envUrl || aff.url;
}
