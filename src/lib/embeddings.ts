/**
 * Embedding generation and similarity utilities.
 * Uses OpenAI text-embedding-3-small (1536 dimensions) via the Vercel AI SDK.
 * Matches the vector(1536) column in the articles table.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';

/**
 * Generate a 1536-dimension embedding for the given text.
 * Truncates input to 8000 chars for token safety.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = createOpenAI({
    apiKey: (import.meta as any).env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
  });
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: text.substring(0, 8000),
  });
  return embedding;
}

/**
 * Compute cosine similarity between two equal-length vectors.
 * Returns a value in [0, 1] where 1 = identical, 0 = orthogonal.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}
