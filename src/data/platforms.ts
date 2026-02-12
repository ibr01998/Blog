/**
 * Platform Data Registry
 * Factual data about crypto exchanges to inject into generated articles.
 * Prevents AI hallucination — every claim is sourced from this registry.
 */

export interface PlatformProfile {
    id: string;
    name: string;
    slug: string;
    founded: number;
    headquarters: string;
    maxLeverage: string;
    makerFee: string;
    takerFee: string;
    tradingPairs: string; // approximate count
    features: string[];
    pros: string[];
    cons: string[];
    bestFor: string; // one-liner target audience
    proofOfReserves: boolean;
    copyTrading: boolean;
    mobileApp: boolean;
    shortDescription: string; // Dutch, 1-2 sentences
}

export const platforms: PlatformProfile[] = [
    {
        id: 'bitmex',
        name: 'BitMEX',
        slug: 'bitmex',
        founded: 2014,
        headquarters: 'Seychellen',
        maxLeverage: '100x',
        makerFee: '-0.01% (rebate)',
        takerFee: '0.075%',
        tradingPairs: '50+',
        features: [
            'Perpetual swaps',
            'Futures contracten',
            'Insurance Fund',
            'Proof of Reserves',
            'Testnet beschikbaar',
        ],
        pros: [
            'Bewezen trackrecord — meer dan 10 jaar operationeel',
            'Maker-rebate — je krijgt betaald om liquiditeit te bieden',
            'Een van de grootste Insurance Funds in de industrie',
            'Publiek inzichtelijk Proof of Reserves',
        ],
        cons: [
            'Interface kan overweldigend zijn voor beginners',
            'Minder altcoins dan sommige concurrenten',
            'Klantenservice kan traag reageren op piekmomenten',
        ],
        bestFor: 'Ervaren traders die waarde hechten aan lage fees en transparantie',
        proofOfReserves: true,
        copyTrading: false,
        mobileApp: true,
        shortDescription: 'Het pionierplatform voor crypto perpetual swaps, opgericht in 2014. Bekend om lage fees en een bewezen trackrecord.',
    },
    {
        id: 'bybit',
        name: 'Bybit',
        slug: 'bybit',
        founded: 2018,
        headquarters: 'Dubai',
        maxLeverage: '100x',
        makerFee: '0.01%',
        takerFee: '0.06%',
        tradingPairs: '300+',
        features: [
            'Perpetual swaps',
            'Spot trading',
            'Copy trading',
            'Launchpad',
            'Earn producten',
        ],
        pros: [
            'Intuïtieve interface — makkelijk voor beginners',
            'Matching engine verwerkt 100.000+ TPS',
            'Breed aanbod aan altcoins en trading pairs',
            'Copy trading functionaliteit',
        ],
        cons: [
            'Hogere maker-fees dan BitMEX',
            'Relatief jong platform (opgericht 2018)',
            'Stortingsbonussen kunnen tot ondoordacht handelen verleiden',
        ],
        bestFor: 'Beginners en gevorderden die een gebruiksvriendelijke interface en breed aanbod willen',
        proofOfReserves: true,
        copyTrading: true,
        mobileApp: true,
        shortDescription: 'Een van de snelst groeiende crypto-exchanges ter wereld. Populair door gebruiksgemak en breed altcoin-aanbod.',
    },
    {
        id: 'binance',
        name: 'Binance',
        slug: 'binance',
        founded: 2017,
        headquarters: 'Diverse locaties',
        maxLeverage: '125x',
        makerFee: '0.02%',
        takerFee: '0.04%',
        tradingPairs: '600+',
        features: [
            'Spot + Futures trading',
            'Launchpad',
            'Earn / Staking',
            'P2P trading',
            'NFT Marketplace',
        ],
        pros: [
            'Grootste exchange ter wereld qua volume',
            'Meeste trading pairs en altcoins',
            'Uitgebreid ecosysteem (DeFi, NFTs, Earn)',
            'Lage fees, extra korting met BNB',
        ],
        cons: [
            'Regelgevingsproblemen in meerdere landen',
            'Interface kan overweldigend zijn door de hoeveelheid features',
            'Beperkte diensten voor Nederlandse gebruikers na regulatie',
        ],
        bestFor: 'Traders die maximale keuze en een volledig ecosysteem willen',
        proofOfReserves: true,
        copyTrading: true,
        mobileApp: true,
        shortDescription: 'De grootste crypto-exchange ter wereld. Biedt het breedste aanbod aan coins, features en trading-opties.',
    },
    {
        id: 'kraken',
        name: 'Kraken',
        slug: 'kraken',
        founded: 2011,
        headquarters: 'San Francisco, VS',
        maxLeverage: '50x',
        makerFee: '0.02%',
        takerFee: '0.05%',
        tradingPairs: '200+',
        features: [
            'Spot + Futures trading',
            'Margin trading',
            'Staking',
            'OTC desk',
            'Kraken Pro interface',
        ],
        pros: [
            'Een van de oudste en meest gereguleerde exchanges',
            'Sterke reputatie op het gebied van veiligheid',
            'Goede klantenservice (24/7 live chat)',
            'Europese banklicentie',
        ],
        cons: [
            'Lagere maximale leverage dan concurrenten',
            'Minder altcoins dan Binance of Bybit',
            'Basis-interface is beperkt; Pro-versie nodig voor gevorderde tools',
        ],
        bestFor: 'Traders die veiligheid en regulering prioriteit geven',
        proofOfReserves: true,
        copyTrading: false,
        mobileApp: true,
        shortDescription: 'Een van de oudste en meest gereguleerde exchanges. Bekend om sterke beveiliging en een Europese banklicentie.',
    },
];

/** Get platform by id */
export function getPlatform(id: string): PlatformProfile | undefined {
    return platforms.find((p) => p.id === id);
}

/** Get multiple platforms by id array */
export function getPlatforms(ids: string[]): PlatformProfile[] {
    return ids.map((id) => getPlatform(id)).filter(Boolean) as PlatformProfile[];
}

/** Get all platform ids */
export function getAllPlatformIds(): string[] {
    return platforms.map((p) => p.id);
}
