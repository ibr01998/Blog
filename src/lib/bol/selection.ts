/**
 * Bol.com Product Selection Logic
 * Filters and scores products based on monetization criteria.
 */

import type { BolProduct, SelectionCriteria, SelectionResult } from './types';

export const DEFAULT_CRITERIA: SelectionCriteria = {
  minRating: 4.2,
  minReviews: 50,
  minPrice: 25,
  maxPrice: 300,
  requireInStock: true,
};

/**
 * Filter products against quality/monetization criteria.
 * Returns selected products (sorted by score) and rejected ones with reasons.
 */
export function filterProducts(
  products: BolProduct[],
  criteria: SelectionCriteria = DEFAULT_CRITERIA
): SelectionResult {
  const selected: BolProduct[] = [];
  const rejected: { product: BolProduct; reason: string }[] = [];

  for (const product of products) {
    const reason = getRejectReason(product, criteria);
    if (reason) {
      rejected.push({ product, reason });
    } else {
      selected.push(product);
    }
  }

  // Sort selected by monetization score (highest first)
  selected.sort((a, b) => scoreProduct(b) - scoreProduct(a));

  return { selected, rejected };
}

function getRejectReason(product: BolProduct, criteria: SelectionCriteria): string | null {
  if (criteria.requireInStock) {
    const unavailable = ['niet leverbaar', 'uitverkocht', 'niet beschikbaar'];
    if (unavailable.some(v => product.availability.toLowerCase().includes(v))) {
      return `Niet beschikbaar (${product.availability})`;
    }
  }

  if (product.rating > 0 && product.rating < criteria.minRating) {
    return `Rating te laag: ${product.rating} (min: ${criteria.minRating})`;
  }

  if (product.reviewCount > 0 && product.reviewCount < criteria.minReviews) {
    return `Te weinig reviews: ${product.reviewCount} (min: ${criteria.minReviews})`;
  }

  if (product.price > 0 && product.price < criteria.minPrice) {
    return `Prijs te laag: \u20AC${product.price} (min: \u20AC${criteria.minPrice})`;
  }

  if (product.price > criteria.maxPrice) {
    return `Prijs te hoog: \u20AC${product.price} (max: \u20AC${criteria.maxPrice})`;
  }

  return null;
}

/**
 * Score a product for monetization potential (0-100).
 * Higher = better monetization opportunity.
 */
function scoreProduct(product: BolProduct): number {
  let score = 0;

  // Price weight (30 points) — sweet spot €50-€200
  if (product.price >= 50 && product.price <= 200) score += 30;
  else if (product.price >= 25 && product.price <= 300) score += 20;
  else score += 10;

  // Rating weight (20 points)
  if (product.rating >= 4.5) score += 20;
  else if (product.rating >= 4.2) score += 15;
  else score += 5;

  // Review count weight (20 points) — social proof
  if (product.reviewCount >= 500) score += 20;
  else if (product.reviewCount >= 200) score += 15;
  else if (product.reviewCount >= 50) score += 10;

  // Delivery speed (10 points) — replaces Amazon Prime
  const label = product.deliveryLabel.toLowerCase();
  if (label.includes('morgen') || label.includes('vandaag')) score += 10;
  else if (label.includes('2') || label.includes('3')) score += 5;

  // Discount (10 points) — urgency factor
  if (product.discountPercent && product.discountPercent >= 20) score += 10;
  else if (product.discountPercent && product.discountPercent >= 10) score += 5;

  // Has features/description (10 points) — better article material
  if (product.features.length >= 3) score += 5;
  if (product.description) score += 5;

  return score;
}

/**
 * Generate human-readable reasoning for why a product was selected.
 */
export function generateSelectionReasoning(
  product: BolProduct,
  rank: number,
  totalCandidates: number
): string {
  const parts: string[] = [];

  parts.push(`Geselecteerd als #${rank} van ${totalCandidates} kandidaten.`);

  if (product.rating >= 4.5) parts.push(`Uitstekende rating (${product.rating}/5).`);
  else if (product.rating > 0) parts.push(`Goede rating (${product.rating}/5).`);

  if (product.reviewCount >= 200) parts.push(`Sterk sociaal bewijs (${product.reviewCount} reviews).`);
  else if (product.reviewCount > 0) parts.push(`${product.reviewCount} reviews.`);

  parts.push(`Prijs: \u20AC${product.price.toFixed(2)}.`);

  const label = product.deliveryLabel.toLowerCase();
  if (label.includes('morgen') || label.includes('vandaag')) {
    parts.push('Snelle levering (hogere conversie).');
  }
  if (product.discountPercent) parts.push(`${product.discountPercent}% korting actief.`);
  if (product.features.length >= 3) parts.push(`${product.features.length} kenmerken voor artikelcontent.`);

  return parts.join(' ');
}
