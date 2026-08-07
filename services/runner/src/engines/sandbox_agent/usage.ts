import { existsSync, readFileSync } from "node:fs";

import type { AgentRunResult, AgentUsage } from "../../protocol.ts";

/** Read the run-total usage Pi wrote on agent_end, from local fs or the sandbox FS API. */
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
