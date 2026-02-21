/**
 * Body Image Generation Utility
 *
 * Generates contextual body images for articles and inserts them into markdown.
 * Uses the existing /api/generate/image endpoint (Google Imagen + Sharp optimization).
 * Called at publish time to keep the editorial pipeline within Vercel timeout limits.
 */

import type { BodyImage } from './agents/types.ts';

interface ImageGenerationParams {
  title: string;
  keyword: string;
  slug: string;
  sectionHeading: string;
  sectionContext: string;
  origin: string;
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
        style: 'halftone',
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
 * Returns the first `maxSections` non-FAQ/conclusion H2 sections.
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

  if (sections.length === 0) return [];

  // Pick first H2 + middle H2 for visual variety
  const selected = sections.length <= maxSections
    ? sections
    : [sections[0], sections[Math.floor(sections.length / 2)]];

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
 * Returns updated markdown and array of generated images.
 */
export async function generateAndInsertBodyImages(params: {
  markdown: string;
  title: string;
  keyword: string;
  slug: string;
  origin: string;
  maxImages?: number;
}): Promise<{ markdown: string; bodyImages: BodyImage[] }> {
  const { markdown, title, keyword, slug, origin, maxImages = 2 } = params;

  const sections = extractH2Sections(markdown, maxImages);
  if (sections.length === 0) {
    return { markdown, bodyImages: [] };
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

  return { markdown: updatedMarkdown, bodyImages: images };
}
