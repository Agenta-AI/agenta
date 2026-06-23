import type { HarnessCapabilities } from "../../protocol.ts";

/**
 * Map a sandbox-agent `AgentInfo` to our capability flags. Falls back to a per-harness
 * static guess when the probe is unavailable.
 */
export function mapCapabilities(harness: string, info: any): HarnessCapabilities {
  const c = info?.capabilities;
  if (c) {
    return {
      textMessages: c.textMessages ?? true,
      images: !!c.images,
      fileAttachments: !!c.fileAttachments,
      mcpTools: !!c.mcpTools,
      toolCalls: !!c.toolCalls,
      reasoning: !!c.reasoning,
      planMode: !!c.planMode,
      permissions: !!c.permissions,
      streamingDeltas: !!c.streamingDeltas,
      sessionLifecycle: !!c.sessionLifecycle,
      usage: true,
    };
  }
  // Static fallback by harness id: pi-acp does not forward MCP, Claude/Codex do.
  const isPiHarness = harness === "pi";
  return {
    textMessages: true,
    images: false,
    fileAttachments: false,
    mcpTools: !isPiHarness,
    toolCalls: true,
    reasoning: true,
    planMode: !isPiHarness,
    permissions: !isPiHarness,
    streamingDeltas: true,
    sessionLifecycle: true,
    usage: true,
  };
}

/** Probe the harness's capabilities from the daemon, falling back to static policy. */
export async function probeCapabilities(
  sandbox: any,
  harness: string,
): Promise<HarnessCapabilities> {
  try {
    const info = await sandbox.getAgent(harness, { config: true });
    return mapCapabilities(harness, info);
  } catch {
    return mapCapabilities(harness, undefined);
  }
}
