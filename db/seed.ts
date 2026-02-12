import { db, Post, Platform } from 'astro:db';
import { platforms } from '../src/data/platforms';

// https://astro.build/db/seed
export default async function seed() {
	await db.insert(Platform).values(platforms);
}
