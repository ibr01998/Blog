/**
 * Amazon Article Generator
 * Standalone AI article generator for Amazon product reviews and roundups.
 * Supports single product reviews and multi-product comparison/roundup articles.
 *
 * Uses Vercel AI SDK directly (not a BaseAgent subclass) to keep the
 * Amazon system independent from the crypto editorial pipeline.
 */

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { AmazonProductRow, GeneratedArticle } from './types';

const TIMEOUT_MS = 120_000; // 120s — matches writer agent

function getAnthropicProvider() {
  return createAnthropic({
    apiKey: (import.meta as any).env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

function parseFeatures(features: string[] | string): string[] {
  if (Array.isArray(features)) return features;
  try { return JSON.parse(features); } catch { return []; }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

// ─── Single Product Review ──────────────────────────────────────────────────────

function buildSingleProductPrompt(product: AmazonProductRow, language: 'nl' | 'en'): { system: string; user: string } {
  const features = parseFeatures(product.features);
  const isNl = language === 'nl';

  const system = isNl
    ? `Je bent een ervaren productreviewer voor ShortNews.tech, een Belgische blog.
Je schrijft eerlijke, gedetailleerde productreviews die lezers helpen een goede aankoopbeslissing te maken.

TAAL: Nederlands (België)
DOELGROEP: Belgische consumenten op zoek naar productinformatie

ARTIKELSTRUCTUUR (gebruik exact deze H2 koppen):
## Overzicht
## Belangrijkste Kenmerken
## Voordelen en Nadelen
## Prijs-Kwaliteit Verhouding
## Voor Wie is Dit Product?
## Veelgestelde Vragen
## Conclusie

REGELS:
- Gebruik ALLEEN gegevens uit de productdata — verzin GEEN specificaties
- Wees eerlijk: noem minimaal 2 nadelen
- Maximaal 3 affiliate links per artikel
- Gebruik contextuele ankertekst: "Bekijk op Amazon", "Bekijk de huidige prijs op Amazon"
- NOOIT "klik hier" gebruiken
- FAQ sectie: precies 3-5 vragen met korte antwoorden
- Eindig met affiliate disclosure tekst

AFFILIATE DISCLOSURE (voeg toe aan het einde):
*Dit artikel bevat affiliate links. Als je via deze links een aankoop doet, ontvangen wij een kleine commissie zonder extra kosten voor jou. Prijs gecontroleerd op ${new Date().toLocaleDateString('nl-BE')}.*

OUTPUT FORMAT:
Geef het volledige artikel als Markdown, beginnend met de H1 titel.
Geef daarna op aparte regels:
---META---
slug: [lowercase-met-koppeltekens]
meta_title: [max 60 tekens, keyword vooraan]
meta_description: [max 155 tekens]
primary_keyword: [hoofdzoekwoord]`
    : `You are an experienced product reviewer for ShortNews.tech, a Belgian blog.
You write honest, detailed product reviews that help readers make informed purchase decisions.

LANGUAGE: English
AUDIENCE: Belgian consumers looking for product information

ARTICLE STRUCTURE (use these exact H2 headings):
## Overview
## Key Features
## Pros and Cons
## Value for Money
## Who Is This Product For?
## Frequently Asked Questions
## Conclusion

RULES:
- Use ONLY data from the product information — do NOT invent specifications
- Be honest: mention at least 2 drawbacks
- Maximum 3 affiliate links per article
- Use contextual anchor text: "Check on Amazon", "See current price on Amazon"
- NEVER use "click here"
- FAQ section: exactly 3-5 questions with brief answers
- End with affiliate disclosure text

AFFILIATE DISCLOSURE (add at the end):
*This article contains affiliate links. If you make a purchase through these links, we receive a small commission at no extra cost to you. Price checked on ${new Date().toLocaleDateString('en-GB')}.*

OUTPUT FORMAT:
Provide the full article as Markdown, starting with the H1 title.
Then on separate lines:
---META---
slug: [lowercase-with-hyphens]
meta_title: [max 60 chars, keyword first]
meta_description: [max 155 chars]
primary_keyword: [main search keyword]`;

  const affiliateUrl = `/go/amazon-${product.asin || slugify(product.title)}`;

  const user = isNl
    ? `Schrijf een productreview voor het volgende product:

PRODUCT: ${product.title}
MERK: ${product.brand || 'Onbekend'}
CATEGORIE: ${product.category || 'Algemeen'}
PRIJS: €${product.current_price.toFixed(2)}${product.list_price ? ` (was €${product.list_price.toFixed(2)})` : ''}
BEOORDELING: ${product.rating > 0 ? `${product.rating}/5 (${product.review_count} reviews)` : 'Nog geen beoordelingen beschikbaar'}
BESCHIKBAARHEID: ${product.availability || 'Beschikbaar'}
${product.prime_eligible ? 'PRIME: Ja (snelle levering)\n' : ''}
KENMERKEN:
${features.length > 0 ? features.map(f => `- ${f}`).join('\n') : '- Geen specificaties beschikbaar'}

${product.description ? `BESCHRIJVING: ${product.description}\n` : ''}
AFFILIATE LINK: ${affiliateUrl}`
    : `Write a product review for the following product:

PRODUCT: ${product.title}
BRAND: ${product.brand || 'Unknown'}
CATEGORY: ${product.category || 'General'}
PRICE: €${product.current_price.toFixed(2)}${product.list_price ? ` (was €${product.list_price.toFixed(2)})` : ''}
RATING: ${product.rating > 0 ? `${product.rating}/5 (${product.review_count} reviews)` : 'No ratings available yet'}
AVAILABILITY: ${product.availability || 'Available'}
${product.prime_eligible ? 'PRIME: Yes (fast delivery)\n' : ''}
FEATURES:
${features.length > 0 ? features.map(f => `- ${f}`).join('\n') : '- No specifications available'}

${product.description ? `DESCRIPTION: ${product.description}\n` : ''}
AFFILIATE LINK: ${affiliateUrl}`;

  return { system, user };
}

// ─── Multi-Product Roundup/Comparison ───────────────────────────────────────────

function buildMultiProductPrompt(products: AmazonProductRow[], language: 'nl' | 'en'): { system: string; user: string } {
  const isNl = language === 'nl';

  const system = isNl
    ? `Je bent een ervaren productreviewer voor ShortNews.tech, een Belgische blog.
Je schrijft vergelijkende productartikelen die lezers helpen het beste product te kiezen.

TAAL: Nederlands (België)
DOELGROEP: Belgische consumenten die producten vergelijken

ARTIKELSTRUCTUUR:
## Onze Top Keuzes (korte samenvatting met ranking)
## [Product Naam] — Review (herhaal voor elk product)
## Vergelijkingstabel
## Welk Product Past Bij Jou?
## Veelgestelde Vragen
## Conclusie

REGELS:
- Gebruik ALLEEN gegevens uit de productdata
- Wees eerlijk en gebalanceerd — elk product heeft voor- én nadelen
- Maximaal 2 affiliate links per product (max 6 totaal)
- Contextuele ankertekst: "Bekijk [Product] op Amazon"
- FAQ sectie: 3-5 vragen
- Maak een Markdown vergelijkingstabel met: Product | Prijs | Beoordeling | Beste Voor
- Eindig met affiliate disclosure

AFFILIATE DISCLOSURE:
*Dit artikel bevat affiliate links. Als je via deze links een aankoop doet, ontvangen wij een kleine commissie zonder extra kosten voor jou. Prijzen gecontroleerd op ${new Date().toLocaleDateString('nl-BE')}.*

OUTPUT FORMAT:
Geef het volledige artikel als Markdown, beginnend met de H1 titel.
Daarna:
---META---
slug: [lowercase-met-koppeltekens]
meta_title: [max 60 tekens]
meta_description: [max 155 tekens]
primary_keyword: [hoofdzoekwoord]`
    : `You are an experienced product reviewer for ShortNews.tech, a Belgian blog.
You write comparative product articles that help readers choose the best product.

LANGUAGE: English
AUDIENCE: Belgian consumers comparing products

ARTICLE STRUCTURE:
## Our Top Picks (brief summary with ranking)
## [Product Name] — Review (repeat for each product)
## Comparison Table
## Which Product Is Right for You?
## Frequently Asked Questions
## Conclusion

RULES:
- Use ONLY data from product information
- Be honest and balanced — every product has pros and cons
- Maximum 2 affiliate links per product (max 6 total)
- Contextual anchor text: "Check [Product] on Amazon"
- FAQ section: 3-5 questions
- Create a Markdown comparison table: Product | Price | Rating | Best For
- End with affiliate disclosure

AFFILIATE DISCLOSURE:
*This article contains affiliate links. If you make a purchase through these links, we receive a small commission at no extra cost to you. Prices checked on ${new Date().toLocaleDateString('en-GB')}.*

OUTPUT FORMAT:
Provide the full article as Markdown, starting with the H1 title.
Then:
---META---
slug: [lowercase-with-hyphens]
meta_title: [max 60 chars]
meta_description: [max 155 chars]
primary_keyword: [main search keyword]`;

  const productBlocks = products.map((p, i) => {
    const features = parseFeatures(p.features);
    const affiliateUrl = `/go/amazon-${p.asin || slugify(p.title)}`;
    return `PRODUCT ${i + 1}:
- Naam: ${p.title}
- Merk: ${p.brand || 'Onbekend'}
- Categorie: ${p.category || 'Algemeen'}
- Prijs: €${p.current_price.toFixed(2)}${p.list_price ? ` (was €${p.list_price.toFixed(2)})` : ''}
- Beoordeling: ${p.rating > 0 ? `${p.rating}/5 (${p.review_count} reviews)` : 'Geen beoordeling'}
${p.prime_eligible ? '- Prime: Ja\n' : ''}- Kenmerken: ${features.length > 0 ? features.slice(0, 5).join('; ') : 'Niet beschikbaar'}
- Affiliate link: ${affiliateUrl}`;
  }).join('\n\n');

  const user = isNl
    ? `Schrijf een vergelijkend artikel over de volgende ${products.length} producten:\n\n${productBlocks}`
    : `Write a comparison article about the following ${products.length} products:\n\n${productBlocks}`;

  return { system, user };
}

// ─── Article Parsing ────────────────────────────────────────────────────────────

function parseGeneratedArticle(text: string, language: 'nl' | 'en'): GeneratedArticle {
  // Split content and meta
  const metaSeparator = '---META---';
  const parts = text.split(metaSeparator);
  let articleMarkdown = parts[0].trim();
  const metaBlock = parts[1] ?? '';

  // Parse meta fields
  const metaLines = metaBlock.split('\n').filter(l => l.trim());
  const meta: Record<string, string> = {};
  for (const line of metaLines) {
    const match = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (match) {
      meta[match[1].trim()] = match[2].trim();
    }
  }

  // Extract title from first H1
  const titleMatch = articleMarkdown.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1] ?? meta.meta_title ?? 'Amazon Product Review';

  // Remove leading H1 from markdown (it's stored separately)
  if (titleMatch) {
    articleMarkdown = articleMarkdown.replace(/^#\s+.+\n*/, '').trim();
  }

  const slug = meta.slug || slugify(title);
  const wordCount = articleMarkdown.split(/\s+/).length;

  return {
    title,
    slug,
    metaDescription: meta.meta_description || title.substring(0, 155),
    metaTitle: meta.meta_title || title.substring(0, 60),
    articleMarkdown,
    wordCount,
    primaryKeyword: meta.primary_keyword || title.split(' ').slice(0, 3).join(' ').toLowerCase(),
    language,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate an Amazon product review or comparison article.
 * Single product → review article.
 * Multiple products → comparison/roundup article.
 */
export async function generateAmazonArticle(
  products: AmazonProductRow[],
  language: 'nl' | 'en' = 'nl'
): Promise<GeneratedArticle> {
  if (products.length === 0) {
    throw new Error('At least one product is required');
  }

  const isSingle = products.length === 1;
  const { system, user } = isSingle
    ? buildSingleProductPrompt(products[0], language)
    : buildMultiProductPrompt(products, language);

  const anthropic = getAnthropicProvider();

  const result = await withTimeout(
    generateText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      system,
      prompt: user,
      maxTokens: 5000,
    } as Parameters<typeof generateText>[0]),
    TIMEOUT_MS,
    `generateAmazonArticle (${products.length} products)`
  );

  return parseGeneratedArticle(result.text, language);
}
