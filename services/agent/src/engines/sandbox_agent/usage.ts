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

/** Combine prompt token counts with stream cost when no Pi usage writeback exists. */
export function mergePromptAndStreamUsage(
  promptResult: any,
  streamUsage: AgentUsage | undefined,
): AgentUsage | undefined {
  const promptUsage = promptResult?.usage;
  const inputTokens = promptUsage?.inputTokens ?? streamUsage?.input ?? 0;
  const outputTokens = promptUsage?.outputTokens ?? streamUsage?.output ?? 0;
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
