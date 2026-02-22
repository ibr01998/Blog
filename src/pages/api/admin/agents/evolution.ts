/**
 * GET /api/admin/agents/evolution
 *
 * Returns per-agent performance history reconstructed from agent_logs
 * (performance:snapshot, evolution:suggestion, evolution:applied entries).
 *
 * Used by the Evolution Radar on /dashboard/agents.
 * Protected by dashboard session cookie (via middleware.ts).
 */

import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db/postgres.ts';

export const GET: APIRoute = async () => {
  try {
    // Fetch all evolvable agents
    const agents = await query<{
      id: string;
      name: string;
      role: string;
      performance_score: number;
      behavior_overrides: Record<string, unknown>;
      is_active: boolean;
    }>(
      `SELECT id, name, role, performance_score, behavior_overrides, is_active
       FROM agents
       WHERE role IN ('writer', 'humanizer', 'seo')
       ORDER BY role`
    );

    // Fetch all evolution-related logs, joining on the writer referenced in input_summary
    const logs = await query<{
      id: string;
      stage: string;
      input_summary: Record<string, any>;
      decision_summary: Record<string, any>;
      reasoning_summary: string | null;
      created_at: string;
      writer_id: string | null;
      writer_name: string | null;
      writer_role: string | null;
    }>(
      `SELECT
         al.id, al.stage,
         al.input_summary, al.decision_summary, al.reasoning_summary,
         al.created_at,
         wa.id   AS writer_id,
         wa.name AS writer_name,
         wa.role AS writer_role
       FROM agent_logs al
       LEFT JOIN agents wa
         ON al.input_summary->>'agent_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND wa.id::text = al.input_summary->>'agent_id'
       WHERE al.stage IN ('evolution:suggestion', 'evolution:applied', 'performance:snapshot')
       ORDER BY al.created_at ASC
       LIMIT 500`
    );

    // Build per-agent response
    const result = agents.map(agent => {
      const agentLogs = logs.filter(l =>
        l.writer_id === agent.id || l.input_summary?.agent_id === agent.id
      );

      const history = agentLogs
        .filter(l => l.input_summary?.avg_ctr !== undefined && l.input_summary?.avg_ctr !== null)
        .map(l => {
          const ctr  = Number(l.input_summary.avg_ctr ?? 0);
          const conv = Number(l.input_summary.avg_conversion_rate ?? 0);
          const score = l.input_summary.performance_score !== undefined
            ? Number(l.input_summary.performance_score)
            : Math.min(1.0, Math.max(0.0, (ctr * 0.4) + (conv * 0.6)));
          return {
            date: l.created_at,
            score,
            ctr,
            conv,
            avg_time_on_page: Number(l.input_summary.avg_time_on_page ?? 0),
            total_articles: Number(l.input_summary.total_articles ?? 0),
            stage: l.stage,
          };
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const appliedLogs = agentLogs.filter(l => l.stage === 'evolution:applied');
      const pendingLogs = agentLogs.filter(l => l.stage === 'evolution:suggestion');

      const scores = history.map(h => h.score);
      const firstScore = scores[0] ?? agent.performance_score;
      const lastScore  = scores[scores.length - 1] ?? agent.performance_score;
      const delta = lastScore - firstScore;
      const trend = delta > 0.03 ? 'improving' : delta < -0.03 ? 'declining' : 'stable';

      return {
        id:                agent.id,
        name:              agent.name,
        role:              agent.role,
        is_active:         agent.is_active,
        current_score:     agent.performance_score,
        behavior_overrides: agent.behavior_overrides,
        history,
        applied_count:     appliedLogs.length,
        pending_count:     pendingLogs.length,
        trend,
        trend_delta:       delta,
      };
    });

    // Overall timeline (suggestion + applied events, most recent first)
    const timelineEvents = logs
      .filter(l => l.stage !== 'performance:snapshot')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50)
      .map(l => ({
        id:               l.id,
        stage:            l.stage,
        date:             l.created_at,
        agent_id:         l.writer_id ?? l.input_summary?.agent_id ?? null,
        agent_name:       l.writer_name ?? l.input_summary?.agent_name ?? null,
        agent_role:       l.writer_role ?? null,
        overrides:        l.decision_summary?.suggested_overrides ?? {},
        reasoning:        l.reasoning_summary,
        metrics: {
          avg_ctr:               l.input_summary?.avg_ctr ?? null,
          avg_conversion_rate:   l.input_summary?.avg_conversion_rate ?? null,
          avg_time_on_page:      l.input_summary?.avg_time_on_page ?? null,
          total_articles:        l.input_summary?.total_articles ?? null,
        },
      }));

    const totalCycles = new Set(
      logs
        .filter(l => l.stage === 'performance:snapshot')
        .map(l => l.created_at.slice(0, 10))
    ).size;

    return new Response(JSON.stringify({
      agents: result,
      timeline: timelineEvents,
      totals: {
        cycles:      totalCycles,
        suggestions: logs.filter(l => l.stage === 'evolution:suggestion').length,
        applied:     logs.filter(l => l.stage === 'evolution:applied').length,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
