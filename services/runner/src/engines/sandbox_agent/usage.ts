import { existsSync, readFileSync } from "node:fs";

import type { AgentRunResult, AgentUsage } from "../../protocol.ts";

interface UsageReader {
  readFsFile?: (input: { path: string }) => Promise<string | Uint8Array>;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Parse untrusted extension output without letting malformed JSON cross the runner contract. */
export function parseRunUsage(value: unknown): AgentUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const input = finiteNonNegative(usage.input);
  const output = finiteNonNegative(usage.output);
  const total = finiteNonNegative(usage.total);
  const cost = finiteNonNegative(usage.cost);
  if (input === undefined || output === undefined || total === undefined) {
    return undefined;
  }
  if (total <= 0 && (cost ?? 0) <= 0) return undefined;
  return { input, output, total, cost: cost ?? 0 };
}

/** Read the run-total usage Pi wrote on agent_end, from local fs or the sandbox FS API. */
export async function readRunUsage(
  sandbox: UsageReader,
  path: string | undefined,
  isDaytona: boolean,
): Promise<AgentRunResult["usage"]> {
  if (!path) return undefined;
  try {
    let raw: string;
    if (isDaytona) {
      if (!sandbox.readFsFile) return undefined;
      const bytes = await sandbox.readFsFile({ path });
      raw = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
    } else {
      if (!existsSync(path)) return undefined;
      raw = readFileSync(path, "utf-8");
    }
    return parseRunUsage(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** Combine prompt token counts with stream cost when no Pi usage writeback exists. */
export function mergePromptAndStreamUsage(
  promptResult: unknown,
  streamUsage: AgentUsage | undefined,
): AgentUsage | undefined {
  const promptUsage =
    promptResult && typeof promptResult === "object"
      ? (
          promptResult as {
            usage?: { inputTokens?: unknown; outputTokens?: unknown };
          }
        ).usage
      : undefined;
  const inputTokens =
    finiteNonNegative(promptUsage?.inputTokens) ?? streamUsage?.input ?? 0;
  const outputTokens =
    finiteNonNegative(promptUsage?.outputTokens) ?? streamUsage?.output ?? 0;
  const total = inputTokens + outputTokens || streamUsage?.total || 0;
  const cost = streamUsage?.cost ?? 0;
  return total > 0 || cost > 0
    ? { input: inputTokens, output: outputTokens, total, cost }
    : undefined;
}

export async function resolveRunUsage({
  sandbox,
  usageOutPath,
  isDaytona,
  promptResult,
  streamUsage,
}: {
  sandbox: UsageReader;
  usageOutPath: string | undefined;
  isDaytona: boolean;
  promptResult: unknown;
  streamUsage: AgentUsage | undefined;
}): Promise<AgentRunResult["usage"]> {
  return (
    (await readRunUsage(sandbox, usageOutPath, isDaytona)) ??
    mergePromptAndStreamUsage(promptResult, streamUsage)
  );
}
