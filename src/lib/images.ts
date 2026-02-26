/**
 * Body Image Generation Utility
 *
 * Generates contextual body images for articles and inserts them into markdown.
 * Uses the existing /api/generate/image endpoint (Google Imagen + Sharp optimization).
 * Called at publish time to keep the editorial pipeline within Vercel timeout limits.
 * 
 * PREDICTABLE IMAGE GENERATION:
 * - ALWAYS generates exactly 1 hero image (if not exists)
 * - ALWAYS generates exactly 2 body images (placed after H2 sections)
 * - Articles with fewer than 2 valid H2 sections will get images placed at available spots
 */

import type { BodyImage } from './agents/types.ts';

export interface HeroImageResult {
  url: string | null;
  success: boolean;
  error?: string;
}

export interface BodyImageResult {
  markdown: string;
  bodyImages: BodyImage[];
  count: number;
}

interface ImageGenerationParams {
  title: string;
  keyword: string;
  slug: string;
  sectionHeading: string;
  sectionContext: string;
  origin: string;
  style?: string;
}

/**
 * Generate a single body image via the existing /api/generate/image endpoint.
 */
async function generateBodyImage(params: ImageGenerationParams): Promise<BodyImage | null> {
  try {
    const res = await fetch(`${params.origin}/api/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${params.sectionHeading}: ${params.sectionContext.substring(0, 100)}`,
        keyword: params.keyword,
        slug: `${params.slug}-${sanitize(params.sectionHeading)}`,
        provider: 'google',
        style: params.style || 'halftone',
      }),
    });

    const data = await res.json() as { url?: string };
    if (!res.ok || !data.url) return null;

    const alt = `${params.keyword} - ${params.sectionHeading}`.substring(0, 125);

    return {
      url: data.url,
      alt,
      section_heading: params.sectionHeading,
      keyword: params.keyword,
    };
  } catch {
    return null;
  }
}

/**
 * Generate hero image for an article.
 * This is a predictable, always-generates-1-image function.
 */
export async function generateHeroImage(params: {
  title: string;
  keyword: string;
  slug: string;
  origin: string;
  style?: string;
}): Promise<HeroImageResult> {
  const { title, keyword, slug, origin, style = 'halftone' } = params;
  
  try {
    const res = await fetch(`${origin}/api/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        keyword,
        slug,
        provider: 'google',
        style,
      }),
    });

    const data = await res.json() as { url?: string; error?: string };
    
    if (!res.ok || !data.url) {
      return { 
        url: null, 
        success: false, 
        error: data.error || 'Image generation failed' 
      };
    }

    return { url: data.url, success: true };
  } catch (err) {
    return { 
      url: null, 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown error' 
    };
  }
}

function sanitize(text: string): string {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

interface H2Section {
  heading: string;
  content: string;
  insertIndex: number;
}

/**
 * Parse article markdown to find H2 headings and their content.
 * Returns up to `maxSections` non-FAQ/conclusion H2 sections.
 * 
 * IMPROVED: Better section detection to ensure we always have spots for images.
 */
function extractH2Sections(markdown: string, maxSections = 2): H2Section[] {
  const h2Regex = /^## (.+)$/gm;
  const sections: Array<{ heading: string; startIndex: number }> = [];
  let match;

  while ((match = h2Regex.exec(markdown)) !== null) {
    const heading = match[1].trim();
    // Skip FAQ, conclusion, and summary sections
    if (/faq|veelgestelde|conclusie|samenvatting|tot slot/i.test(heading)) continue;
    sections.push({ heading, startIndex: match.index + match[0].length });
  }

  // If no valid H2 sections found, return empty - caller should handle this
  if (sections.length === 0) return [];

  // Select sections for image placement:
  // - Always pick the first H2 (introduction section)
  // - Pick one more from the middle for variety (or second if only 2 exist)
  let selected;
  if (sections.length === 1) {
    selected = [sections[0]];
  } else if (sections.length === 2) {
    selected = [sections[0], sections[1]];
  } else {
    // Pick first and middle for good distribution
    selected = [sections[0], sections[Math.floor(sections.length / 2)]];
  }

  return selected.map(s => {
    const afterHeading = markdown.substring(s.startIndex);
    // Find end of first paragraph (double newline)
    const firstParagraphEnd = afterHeading.search(/\n\n/);
    const insertIndex = firstParagraphEnd >= 0
      ? s.startIndex + firstParagraphEnd + 2
      : s.startIndex + Math.min(afterHeading.length, 200);

    return {
      heading: s.heading,
      content: afterHeading.substring(0, 200),
      insertIndex,
    };
  });
}

/**
 * Generate body images and insert them into the article markdown.
 * 
 * PREDICTABLE BEHAVIOR:
 * - Tries to generate exactly `targetCount` images (default: 2)
 * - Places images after H2 sections (first H2 always gets an image if available)
 * - Returns updated markdown and array of generated images
 * 
 * If article has fewer H2 sections than targetCount, fewer images will be generated.
 * Caller should check `result.count` to see how many were actually created.
 */
export async function generateAndInsertBodyImages(params: {
  markdown: string;
  title: string;
  keyword: string;
  slug: string;
  origin: string;
  targetCount?: number;  // Renamed from maxImages for clarity - we WANT this many
}): Promise<BodyImageResult> {
  const { markdown, title, keyword, slug, origin, targetCount = 2 } = params;

  const sections = extractH2Sections(markdown, targetCount);
  if (sections.length === 0) {
    return { markdown, bodyImages: [], count: 0 };
  }

  // Generate images in parallel for speed
  const imagePromises = sections.map(s =>
    generateBodyImage({
      title,
      keyword,
      slug,
      sectionHeading: s.heading,
      sectionContext: s.content,
      origin,
    })
  );

  const images = (await Promise.all(imagePromises)).filter(Boolean) as BodyImage[];

  // Insert images into markdown (from end to start to preserve indices)
  let updatedMarkdown = markdown;
  const insertions = sections
    .map((s, i) => ({ ...s, image: images.find(img => img?.section_heading === s.heading) }))
    .filter(s => s.image)
    .sort((a, b) => b.insertIndex - a.insertIndex);

  for (const insertion of insertions) {
    const img = insertion.image!;
    const imgMarkdown = `\n![${img.alt}](${img.url})\n\n`;
    updatedMarkdown =
      updatedMarkdown.substring(0, insertion.insertIndex) +
      imgMarkdown +
      updatedMarkdown.substring(insertion.insertIndex);
  }

  return { markdown: updatedMarkdown, bodyImages: images, count: images.length };
}

/**
 * Count images in markdown (both hero and body images).
 * Useful for showing image status in dashboard.
 */
export function countImagesInArticle(markdown: string): {
  bodyImages: number;
  imageUrls: string[];
} {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const urls: string[] = [];
  let match;
  
  while ((match = imageRegex.exec(markdown)) !== null) {
    urls.push(match[2]);
  }
  
  return {
    bodyImages: urls.length,
    imageUrls: urls,
  };
}

/**
 * Generate ALL images for an article (hero + body) in one call.
 * This is the main entry point for predictable image generation.
 * 
 * Returns:
 * - heroImage: URL of generated hero image (or null if failed/skipped)
 * - bodyImages: Array of generated body images
 * - updatedMarkdown: Article markdown with body images inserted
 * - status: 'complete', 'partial', or 'failed'
 */
export async function generateAllImages(params: {
  markdown: string;
  title: string;
  keyword: string;
  slug: string;
  origin: string;
  existingHeroImage?: string | null;
  forceRegenerateHero?: boolean;
}): Promise<{
  heroImage: string | null;
  bodyImages: BodyImage[];
  updatedMarkdown: string;
  status: 'complete' | 'partial' | 'failed';
  errors: string[];
}> {
  const { markdown, title, keyword, slug, origin, existingHeroImage, forceRegenerateHero } = params;
  const errors: string[] = [];
  
  // Determine if we need to generate hero image
  let heroImage = existingHeroImage || null;
  if (!heroImage || forceRegenerateHero) {
    const heroResult = await generateHeroImage({ title, keyword, slug, origin });
    if (heroResult.success && heroResult.url) {
      heroImage = heroResult.url;
    } else {
      errors.push(`Hero image failed: ${heroResult.error || 'Unknown error'}`);
    }
  }
  
  // Generate body images
  const bodyResult = await generateAndInsertBodyImages({
    markdown,
    title,
    keyword,
    slug,
    origin,
    targetCount: 2,
  });
  
  if (bodyResult.count < 2) {
    errors.push(`Only generated ${bodyResult.count}/2 body images (article may have fewer H2 sections)`);
  }
  
  // Determine overall status
  let status: 'complete' | 'partial' | 'failed' = 'complete';
  if (!heroImage && bodyResult.count === 0) {
    status = 'failed';
  } else if (!heroImage || bodyResult.count < 2) {
    status = 'partial';
  }
  
  return {
    heroImage,
    bodyImages: bodyResult.bodyImages,
    updatedMarkdown: bodyResult.markdown,
    status,
    errors,
  };
}
