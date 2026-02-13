/**
 * POST /api/generate/image
 * Generates a hero image for an article using OpenAI DALL-E 3 or Google Imagen 4.
 * Saves the image to public/images/articles/{slug}.png
 * Returns the URL path for use as heroImage.
 */
import type { APIRoute } from 'astro';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const {
            title,
            keyword = '',
            slug,
            provider = 'google', // 'openai' | 'google'
            style = 'futuristic', // 'futuristic' | 'photorealistic' | 'abstract' | 'illustration'
        } = body;

        if (!title || !slug) {
            return new Response(JSON.stringify({ error: 'title en slug zijn verplicht' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Build prompt based on style
        const stylePrompts: Record<string, string> = {
            futuristic: 'futuristic digital art style with neon accents, dark background (#111827), glowing crypto symbols, modern tech aesthetic',
            photorealistic: 'professional photorealistic style, clean composition, dark moody lighting, financial/trading theme',
            abstract: 'abstract modern art style, geometric shapes, dark background with gold (#EAB308) and blue accents, minimalist',
            illustration: 'clean vector illustration style, flat design with subtle gradients, dark theme with warm gold highlights',
        };

        const styleDesc = stylePrompts[style] || stylePrompts['futuristic'];

        // Optimized prompt to avoid text generation and focus on visuals
        const subject = keyword || title;
        const imagePrompt = `A high-quality, ${styleDesc} digital artwork representing the concept of "${subject}".
The image should be visually striking, professional, and suitable as a blog hero banner.
IMPORTANT: Do NOT include any text, letters, words, or typography in the image. The image must be purely visual/symbolic.`;

        let imageBuffer: Buffer;

        if (provider === 'openai') {
            // --- OpenAI DALL-E 3 ---
            const client = new OpenAI({ apiKey: import.meta.env.OPENAI_API_KEY });

            const response = await client.images.generate({
                model: 'dall-e-3',
                prompt: imagePrompt,
                n: 1,
                size: '1792x1024', // Closest to 1200x630 aspect ratio
                quality: 'standard', // $0.08 — good enough, saves cost vs HD
                response_format: 'b64_json',
            });

            const b64 = response.data[0]?.b64_json;
            if (!b64) throw new Error('OpenAI returned no image data');
            imageBuffer = Buffer.from(b64, 'base64');

        } else {
            // --- Google Imagen 4 ---
            const genai = new GoogleGenAI({ apiKey: import.meta.env.GOOGLE_GENERATIVE_AI_API_KEY });

            const response = await genai.models.generateImages({
                model: 'imagen-4.0-generate-preview-06-06',
                prompt: imagePrompt,
                config: {
                    numberOfImages: 1,
                },
            });

            const imageData = response.generatedImages?.[0]?.image?.imageBytes;
            if (!imageData) throw new Error('Google returned no image data');
            imageBuffer = Buffer.from(imageData, 'base64');
        }

        // Save to public/images/articles/
        const imagesDir = path.join(process.cwd(), 'public', 'images', 'articles');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        const sanitizedSlug = slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        const filename = `${sanitizedSlug}.png`;
        const filepath = path.join(imagesDir, filename);

        fs.writeFileSync(filepath, imageBuffer);

        const imageUrl = `/images/articles/${filename}`;

        return new Response(JSON.stringify({
            success: true,
            imageUrl,
            provider,
            style,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error('Image generation error:', error);
        return new Response(JSON.stringify({
            error: 'Er ging iets mis bij het genereren van de afbeelding.',
            details: error?.message || 'Unknown error',
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
