/**
 * BaseAgent — foundation class for all editorial agents.
 * Handles:
 *  - Loading agent records from Postgres
 *  - Merging personality_config + behavior_overrides (overrides win)
 *  - Wrapping Vercel AI SDK calls (generateText / generateObject)
 *  - Writing reasoning logs to agent_logs table
 */

import { generateText, generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { ZodSchema } from 'zod';

// Lazily create the provider on each call so the API key is read at request
// time (not at module-load time), which avoids SSR module-caching edge cases.
function getOpenAIProvider() {
  return createOpenAI({
    apiKey: (import.meta as any).env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
  });
}
import { query } from '../db/postgres.ts';
import type { AgentRole, AgentRecord, PersonalityConfig, BehaviorOverrides } from './types.ts';

export type { AgentRecord };

export class BaseAgent {
  protected record: AgentRecord;
  protected mergedConfig: PersonalityConfig & BehaviorOverrides;

  constructor(record: AgentRecord) {
    this.record = record;
    // behavior_overrides always win — shallow merge, overrides take precedence
    this.mergedConfig = {
      ...record.personality_config,
      ...record.behavior_overrides,
    };
  }

  /**
   * Factory: load first active agent for a given role, ordered by performance_score DESC.
   */
  static async loadByRole(role: AgentRole): Promise<AgentRecord> {
    const rows = await query<AgentRecord>(
      `SELECT * FROM agents WHERE role = $1 AND is_active = true ORDER BY performance_score DESC LIMIT 1`,
      [role]
    );
    if (rows.length === 0) {
      throw new Error(`No active agent found for role: ${role}`);
    }
    return rows[0];
  }

  /**
   * Factory: load a specific agent by UUID.
   */
  static async loadById(id: string): Promise<AgentRecord> {
    const rows = await query<AgentRecord>(
      `SELECT * FROM agents WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (rows.length === 0) {
      throw new Error(`Agent not found: ${id}`);
    }
    return rows[0];
  }

  /**
   * Generate free-form text via the Vercel AI SDK (wraps generateText).
   * Consistent with the existing outline.ts / block.ts pattern in this project.
   */
  protected async callText(params: {
    systemPrompt: string;
    userPrompt: string;
    model?: string;
    maxTokens?: number;
  }): Promise<string> {
    const result = await generateText({
      model: getOpenAIProvider()(params.model ?? 'gpt-4o'),
      system: params.systemPrompt,
      prompt: params.userPrompt,
      // maxTokens: accepted at runtime but type definition varies by SDK version
      ...(params.maxTokens ? ({ maxTokens: params.maxTokens } as object) : {}),
    } as Parameters<typeof generateText>[0]);
    return result.text;
  }

  /**
   * Generate a structured object via the Vercel AI SDK (wraps generateObject).
   * Schema must be a Zod schema. Returns the parsed, validated object.
   */
  protected async callObject<T>(params: {
    systemPrompt: string;
    userPrompt: string;
    schema: ZodSchema<T>;
    model?: string;
  }): Promise<T> {
    const result = await generateObject({
      model: getOpenAIProvider()(params.model ?? 'gpt-4o'),
      system: params.systemPrompt,
      prompt: params.userPrompt,
      schema: params.schema,
    });
    return result.object;
  }

  /**
   * Persist a reasoning log entry to agent_logs.
   * Call at the end of each significant decision in an agent's run() method.
   */
  async log(params: {
    articleId?: string | null;
    stage: string;
    inputSummary: Record<string, unknown>;
    decisionSummary: Record<string, unknown>;
    reasoningSummary: string;
  }): Promise<void> {
    await query(
      `INSERT INTO agent_logs (agent_id, article_id, stage, input_summary, decision_summary, reasoning_summary)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.record.id,
        params.articleId ?? null,
        params.stage,
        JSON.stringify(params.inputSummary),
        JSON.stringify(params.decisionSummary),
        params.reasoningSummary,
      ]
    );
  }

  // Getters
  get id() { return this.record.id; }
  get name() { return this.record.name; }
  get role() { return this.record.role; }
  get config() { return this.mergedConfig; }
}
