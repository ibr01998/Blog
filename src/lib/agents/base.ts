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
import { createAnthropic } from '@ai-sdk/anthropic';
import type { ZodSchema } from 'zod';

// Lazily create providers on each call so API keys are read at request
// time (not at module-load time), which avoids SSR module-caching edge cases.
function getOpenAIProvider() {
  return createOpenAI({
    apiKey: (import.meta as any).env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
  });
}

function getAnthropicProvider() {
  return createAnthropic({
    apiKey: (import.meta as any).env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  });
}

/**
 * Resolve a model string to a Vercel AI SDK model instance.
 * Supports prefixed format: "anthropic:model-id" or "openai:model-id".
 * Unprefixed strings default to OpenAI for backwards compatibility.
 */
function resolveModel(model: string) {
  if (model.startsWith('anthropic:')) {
    return getAnthropicProvider()(model.slice('anthropic:'.length));
  }
  if (model.startsWith('openai:')) {
    return getOpenAIProvider()(model.slice('openai:'.length));
  }
  // Default: OpenAI (backwards compatible)
  return getOpenAIProvider()(model);
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
    timeoutMs?: number;
  }): Promise<string> {
    const timeout = params.timeoutMs ?? 60000; // Default 60s timeout

    const result = await this.withTimeout(
      generateText({
        model: resolveModel(params.model ?? 'gpt-4o'),
        system: params.systemPrompt,
        prompt: params.userPrompt,
        // maxTokens: accepted at runtime but type definition varies by SDK version
        ...(params.maxTokens ? ({ maxTokens: params.maxTokens } as object) : {}),
      } as Parameters<typeof generateText>[0]),
      timeout,
      `callText (model: ${params.model ?? 'gpt-4o'})`
    );
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
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<T> {
    const timeout = params.timeoutMs ?? 60000; // Default 60s timeout

    const result = await this.withTimeout(
      generateObject({
        model: resolveModel(params.model ?? 'gpt-4o'),
        system: params.systemPrompt,
        prompt: params.userPrompt,
        schema: params.schema,
        ...(params.maxTokens ? ({ maxTokens: params.maxTokens } as object) : {}),
      }),
      timeout,
      `callObject (model: ${params.model ?? 'gpt-4o'})`
    );
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

  /**
   * Apply additional overrides to the in-memory merged config.
   * Used by the orchestrator to apply analyst evolution suggestions
   * to agents before they run in the current cycle.
   */
  applyOverrides(overrides: Record<string, unknown>): void {
    this.mergedConfig = { ...this.mergedConfig, ...overrides } as PersonalityConfig & BehaviorOverrides;
  }

  /**
   * Wraps a promise with a timeout to prevent hanging indefinitely.
   * Used to add timeout protection to AI SDK calls.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  // Getters
  get id() { return this.record.id; }
  get name() { return this.record.name; }
  get role() { return this.record.role; }
  get config() { return this.mergedConfig; }
}
