import type { APIRoute } from 'astro';
import { db, Platform, eq } from 'astro:db';

export const GET: APIRoute = async () => {
    try {
        const platforms = await db.select().from(Platform).orderBy(Platform.name);
        return new Response(JSON.stringify(platforms), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to fetch platforms' }), {
            status: 500
        });
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();

        // Basic validation
        if (!body.name || !body.slug) {
            return new Response(JSON.stringify({ error: 'Name and slug are required' }), { status: 400 });
        }

        // Check if exists
        const existing = await db.select().from(Platform).where(eq(Platform.slug, body.slug));
        if (existing.length > 0) {
            return new Response(JSON.stringify({ error: 'Platform already exists' }), { status: 409 });
        }

        // Insert
        await db.insert(Platform).values({
            id: body.slug, // Use slug as ID
            name: body.name,
            slug: body.slug,
            affiliateLink: body.affiliateLink || '',
            founded: body.founded ? parseInt(body.founded) : undefined,
            headquarters: body.headquarters || '',
            maxLeverage: body.maxLeverage || '',
            makerFee: body.makerFee || '',
            takerFee: body.takerFee || '',
            tradingPairs: body.tradingPairs || '',
            features: body.features || [],
            pros: body.pros || [],
            cons: body.cons || [],
            bestFor: body.bestFor || '',
            shortDescription: body.shortDescription || '',
        });

        return new Response(JSON.stringify({ success: true, slug: body.slug }), { status: 201 });

    } catch (error: any) {
        console.error('Error adding platform:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};

export const PATCH: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { id, ...data } = body;

        if (!id) return new Response(JSON.stringify({ error: 'ID is required' }), { status: 400 });

        await db.update(Platform).set(data).where(eq(Platform.id, id));

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error: any) {
        console.error('Error updating platform:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};

export const DELETE: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { id } = body;

        if (!id) return new Response(JSON.stringify({ error: 'ID is required' }), { status: 400 });

        await db.delete(Platform).where(eq(Platform.id, id));

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error: any) {
        console.error('Error deleting platform:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
