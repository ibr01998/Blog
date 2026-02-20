/**
 * Amazon Product Selection Logic
 * Filters and scores products based on monetization criteria.
 */

import type { AmazonProduct, SelectionCriteria, SelectionResult } from './types';

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
  products: AmazonProduct[],
  criteria: SelectionCriteria = DEFAULT_CRITERIA
): SelectionResult {
  const selected: AmazonProduct[] = [];
  const rejected: { product: AmazonProduct; reason: string }[] = [];

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

function getRejectReason(product: AmazonProduct, criteria: SelectionCriteria): string | null {
  if (criteria.requireInStock && product.availability !== 'Now') {
    // Allow common availability values
    const available = ['Now', 'InStock', 'Available', 'Unknown'];
    if (!available.some(v => product.availability.includes(v))) {
      return `Out of stock (availability: ${product.availability})`;
    }
  }

  if (product.rating > 0 && product.rating < criteria.minRating) {
    return `Rating too low: ${product.rating} (min: ${criteria.minRating})`;
  }

  if (product.reviewCount > 0 && product.reviewCount < criteria.minReviews) {
    return `Too few reviews: ${product.reviewCount} (min: ${criteria.minReviews})`;
  }

  if (product.price > 0 && product.price < criteria.minPrice) {
    return `Price too low: €${product.price} (min: €${criteria.minPrice})`;
  }

  if (product.price > criteria.maxPrice) {
    return `Price too high: €${product.price} (max: €${criteria.maxPrice})`;
  }

  return null;
}

/**
 * Score a product for monetization potential (0-100).
 * Higher = better monetization opportunity.
 */
function scoreProduct(product: AmazonProduct): number {
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

  // Prime eligible (10 points) — higher conversion
  if (product.primeEligible) score += 10;

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
  product: AmazonProduct,
  rank: number,
  totalCandidates: number
): string {
  const parts: string[] = [];

  parts.push(`Selected as #${rank} of ${totalCandidates} candidates.`);

  if (product.rating >= 4.5) parts.push(`Excellent rating (${product.rating}/5).`);
  else if (product.rating > 0) parts.push(`Good rating (${product.rating}/5).`);

  if (product.reviewCount >= 200) parts.push(`Strong social proof (${product.reviewCount} reviews).`);
  else if (product.reviewCount > 0) parts.push(`${product.reviewCount} reviews.`);

  parts.push(`Price: €${product.price.toFixed(2)}.`);

  if (product.primeEligible) parts.push('Prime eligible (higher conversion rate).');
  if (product.discountPercent) parts.push(`${product.discountPercent}% discount active.`);
  if (product.features.length >= 3) parts.push(`${product.features.length} features for article content.`);

  return parts.join(' ');
}
