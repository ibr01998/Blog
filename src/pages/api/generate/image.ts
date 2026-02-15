/**
 * POST /api/generate/image
 * Generates a hero image for an article using OpenAI DALL-E 3 or Google Imagen 4.
 * Saves the image to public/images/articles/{slug}.png
 * Returns the URL path for use as heroImage.
 */
import type { APIRoute } from 'astro';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { put } from '@vercel/blob';
import sharp from 'sharp';

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const {
            title,
            keyword = '',
            slug,
            provider = 'google', // 'openai' | 'google'
            style = 'halftone', // Default to halftone
        } = body;

        if (!title || !slug) {
            return new Response(JSON.stringify({ error: 'title en slug zijn verplicht' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Build prompt based on style
        const stylePrompts: Record<string, string> = {
            halftone: 'black and white grainy newspaper aesthetic, gritty halftone texture, high contrast, minimalist, cryptopunk data visualization style',
            futuristic: 'monochrome futuristic digital art style with neon accents, dark background, glowing crypto symbols',
            photorealistic: 'black and white professional photography style, dramatic lighting, financial theme',
            illustration: 'clean black and white vector line art, minimalist technical drawing',
        };

        const styleDesc = stylePrompts[style] || stylePrompts['halftone'];

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
                size: '1024x1024',
                quality: 'standard', // $0.04
                response_format: 'b64_json',
            });

            const b64 = response.data[0]?.b64_json;
            if (!b64) throw new Error('OpenAI returned no image data');
            imageBuffer = Buffer.from(b64, 'base64');

        } else {
            // --- Google Imagen 4 (via GenAI SDK) ---
            const genai = new GoogleGenAI({ apiKey: import.meta.env.GOOGLE_GENERATIVE_AI_API_KEY });

            const response = await genai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: imagePrompt,
                config: {
                    numberOfImages: 1,
                },
            });

            const imageData = response.generatedImages?.[0]?.image?.imageBytes;
            if (!imageData) throw new Error('Google returned no image data');
            imageBuffer = Buffer.from(imageData, 'base64');
        }

        // Optimize with Sharp (Resize & Compress)
        let optimizedBuffer: Buffer;
        try {
            optimizedBuffer = await sharp(imageBuffer)
                .resize({ width: 1200, withoutEnlargement: true }) // standard web width
                .jpeg({ quality: 80, mozjpeg: true }) // efficient compression
                .toBuffer();
        } catch (sharpError) {
            console.error('Sharp optimization failed:', sharpError);
            optimizedBuffer = imageBuffer; // Fallback to original
        }

        // Save to Vercel Blob
        let imageUrl: string;

        try {
            const sanitizedSlug = slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
            const filename = `articles/${sanitizedSlug}-${Date.now()}.jpg`; // Unique name

            const blob = await put(filename, optimizedBuffer, {
                access: 'public',
            });

            imageUrl = blob.url;

        } catch (blobError) {
            console.warn('Vercel Blob upload failed (check BLOB_READ_WRITE_TOKEN), fallback to Base64:', blobError);
            // Fallback: Return Base64 Data URI
            imageUrl = `data:image/jpeg;base64,${optimizedBuffer.toString('base64')}`;
        }

        return new Response(JSON.stringify({
            success: true,
            url: imageUrl,
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
