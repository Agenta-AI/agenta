import { existsSync, readFileSync } from "node:fs";

import type {
  AgentRunResult,
  AgentUsage,
  ModelTokenUsage,
} from "../../protocol.ts";

/** Read the run-total usage Pi wrote on agent_settled, from local fs or the sandbox FS API. */
export async function readRunUsage(
  sandbox: any,
  path: string | undefined,
  isDaytona: boolean,
): Promise<AgentRunResult["usage"]> {
  if (!path) return undefined;
  try {
    let raw: string;
    if (isDaytona) {
      const bytes = await sandbox.readFsFile({ path });
      raw = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
    } else {
      if (!existsSync(path)) return undefined;
      raw = readFileSync(path, "utf-8");
    }
    const u = JSON.parse(raw);
    return u && u.total > 0 ? u : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Combine prompt token counts with stream cost when no Pi usage writeback exists.
 *
 * The token total is ONLY ever the harness-reported split. There is no fallback token
 * source: the ACP stream's `usage_update.used` is the agent's context-window occupancy,
 * not a count of the tokens this run spent, so it must never become a token total. When
 * the harness reports no split, this returns no tokens at all (cost alone still counts as
 * usage) — absent data has to read as absent, because a plausible-looking wrong total
 * silently poisons every aggregate built on it.
 *
 * Cost follows the same rule via omission: an unreported cost leaves the key OFF, because a
 * substituted `0` would claim the run was measured and free. A reported cost is passed through
 * as-is, including a genuine `0`.
 */
export function mergePromptAndStreamUsage(
  promptResult: any,
  streamUsage: AgentUsage | undefined,
): AgentUsage | undefined {
  const promptUsage = promptResult?.usage;
  const inputTokens = promptUsage?.inputTokens ?? streamUsage?.input ?? 0;
  const outputTokens = promptUsage?.outputTokens ?? streamUsage?.output ?? 0;
  const total = inputTokens + outputTokens;
  const cost = streamUsage?.cost;
  const hasCost = cost != null;
  return total > 0 || hasCost
    ? {
        input: inputTokens,
        output: outputTokens,
        total,
        ...(hasCost ? { cost } : {}),
      }
    : undefined;
}

export async function resolveRunUsage({
  sandbox,
  usageOutPath,
  isDaytona,
  promptResult,
  streamUsage,
}: {
  sandbox: any;
  usageOutPath: string | undefined;
  isDaytona: boolean;
  promptResult: any;
  streamUsage: AgentUsage | undefined;
}): Promise<AgentRunResult["usage"]> {
  return (
    (await readRunUsage(sandbox, usageOutPath, isDaytona)) ??
    mergePromptAndStreamUsage(promptResult, streamUsage)
  );
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/**
 * The turn's token counts for its model span, read from the ACP PromptResponse.
 *
 * `perModel` sums `_meta.quota.model_usage`, which claude-agent-acp fills with one row per model
 * for THIS turn (subagents and compaction included, cache reads and writes split out). Codex
 * fills the same field with its last model call only, so it must not ask for it. Otherwise the
 * response's own `usage` gives the counts, still with its cache counts.
 */
export function promptTokenDetail(
  promptResult: any,
  { perModel }: { perModel: boolean },
): ModelTokenUsage | undefined {
  const rows = promptResult?._meta?.quota?.model_usage;
  if (perModel && Array.isArray(rows)) {
    const summed = sumTokens(
      rows.map((row: any) => {
        const t = row?.token_count ?? {};
        return {
          input: count(t.inputTokens),
          output: count(t.outputTokens),
          cacheRead: count(t.cachedInputTokens),
          cacheWrite: count(t.cachedWriteTokens),
        };
      }),
    );
    if (summed) return summed;
  }
  const u = promptResult?.usage;
  if (!u) return undefined;
  return sumTokens([
    {
      input: count(u.inputTokens),
      output: count(u.outputTokens),
      cacheRead: count(u.cachedReadTokens),
      cacheWrite: count(u.cachedWriteTokens),
    },
  ]);
}

function sumTokens(rows: ModelTokenUsage[]): ModelTokenUsage | undefined {
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const row of rows) {
    sum.input += row.input;
    sum.output += row.output;
    sum.cacheRead += row.cacheRead;
    sum.cacheWrite += row.cacheWrite;
  }
  return sum.input + sum.output + sum.cacheRead + sum.cacheWrite > 0
    ? sum
    : undefined;
}

/**
 * This turn's share of a harness cost that is a running total for the whole session.
 *
 * Claude Code reports `total_cost_usd` for the session, and a pooled session serves many turns,
 * so the turn's cost is the new reading minus the one before it. With no earlier reading, a new
 * session started at zero, but a session loaded from an earlier one starts at that session's
 * total, which this runner never saw; that turn's cost is unknown. A reading below the previous
 * one means the total restarted, so the reading itself is the turn's cost.
 */
export function turnCostFromRunningTotal(
  reading: number | undefined,
  previous: number | undefined,
  sessionLoaded: boolean,
): number | undefined {
  if (reading == null || !Number.isFinite(reading)) return undefined;
  if (previous == null) return sessionLoaded ? undefined : reading;
  const delta = reading >= previous ? reading - previous : reading;
  return Math.round(delta * 1e10) / 1e10;
}
