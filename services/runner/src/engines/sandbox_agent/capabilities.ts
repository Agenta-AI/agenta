import type { HarnessCapabilities, ResolvedToolSpec } from "../../protocol.ts";

/**
 * Where a run's `HarnessCapabilities` came from.
 *
 *  - `probed`: read from the daemon's `AgentInfo.capabilities` for this exact harness.
 *  - `static`: the daemon probe was unavailable (or returned no capabilities), so we fell
 *    back to a per-harness static guess. A guess is a weaker contract — it can disagree with
 *    what the harness actually does — so callers that assert a hard capability requirement use
 *    the source to phrase a clear error instead of trusting the guess.
 */
export type CapabilitySource = "probed" | "static";

export interface ProbedCapabilities {
  capabilities: HarnessCapabilities;
  source: CapabilitySource;
}

/** Every capability flag the runner branches on, for the debug-assertion shape check. */
const CAPABILITY_FLAGS = [
  "textMessages",
  "images",
  "fileAttachments",
  "mcpTools",
  "toolCalls",
  "reasoning",
  "planMode",
  "permissions",
  "streamingDeltas",
  "sessionLifecycle",
  "usage",
] as const;

/**
 * Debug assertion: throw on an impossible runner state with an actionable message. These guard
 * the runner hot path (run-plan build, capability probe, capability gate, sandbox start) so an
 * impossible state surfaces at its origin with context instead of as a confusing downstream
 * failure. Cheap (a boolean test) and always on — a tripped invariant is a runner bug, not a
 * user error.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[sandbox-agent invariant] ${message}`);
}

/**
 * A run asked for a capability the harness does not have. Mirrors the not-implemented gates
 * (`tools/code.ts` `CODE_TOOL_UNSUPPORTED_MESSAGE`, #4831's `*_UNSUPPORTED_MESSAGE`): the run
 * fails with one clear, specific line rather than silently dropping the behavior. Built by
 * `assertRequiredCapabilities`.
 */
export function toolDeliveryUnsupportedMessage(
  harness: string,
  missing: string,
  toolCount: number,
): string {
  return (
    `harness '${harness}' cannot receive tools (probe reports ${missing}); ` +
    `the run carries ${toolCount} tool(s) that would be silently dropped. Run on a ` +
    `tool-capable harness, or remove the tools.`
  );
}

/**
 * Map a sandbox-agent `AgentInfo` to our capability flags. Falls back to a per-harness static
 * guess when the probe is unavailable. Returns the flags AND where they came from, so a caller
 * can refuse to silently degrade on a guess (see `assertRequiredCapabilities`).
 */
export function mapCapabilities(
  harness: string,
  info: any,
): ProbedCapabilities {
  assert(
    typeof harness === "string" && harness.length > 0,
    "mapCapabilities requires a non-empty harness id",
  );
  const c = info?.capabilities;
  if (c) {
    assert(
      typeof c === "object",
      `probed capabilities for '${harness}' is not an object (got ${typeof c})`,
    );
    return {
      source: "probed",
      capabilities: {
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
      },
    };
  }
  // Static fallback by harness id: pi-acp does not forward MCP, Claude/opencode do.
  // opencode is excluded from plan-mode (the daemon skips session/set_mode for it).
  const isPiHarness = harness === "pi";
  const isOpencode = harness === "opencode";
  return {
    source: "static",
    capabilities: {
      textMessages: true,
      images: false,
      fileAttachments: false,
      mcpTools: !isPiHarness,
      toolCalls: true,
      reasoning: true,
      planMode: !isPiHarness && !isOpencode,
      permissions: !isPiHarness,
      streamingDeltas: true,
      sessionLifecycle: true,
      usage: true,
    },
  };
}

/** Probe the harness's capabilities from the daemon, falling back to static policy. */
export async function probeCapabilities(
  sandbox: any,
  harness: string,
): Promise<ProbedCapabilities> {
  assert(
    sandbox && typeof sandbox.getAgent === "function",
    "probeCapabilities requires a sandbox with getAgent()",
  );
  let probed: ProbedCapabilities;
  try {
    const info = await sandbox.getAgent(harness, { config: true });
    probed = mapCapabilities(harness, info);
  } catch {
    probed = mapCapabilities(harness, undefined);
  }
  // Debug assertion: the mapper must always return a complete, boolean-valued flag set so a
  // downstream branch never reads an undefined flag (which would coerce to a silent `false`).
  for (const flag of CAPABILITY_FLAGS) {
    assert(
      typeof probed.capabilities[flag] === "boolean",
      `capability '${flag}' for '${harness}' is ${typeof probed.capabilities[flag]}, expected boolean`,
    );
  }
  return probed;
}

export interface AssertCapabilitiesInput {
  harness: string;
  isPi: boolean;
  probed: ProbedCapabilities;
  toolSpecs: ResolvedToolSpec[];
  /** Hook for the debug log; the engine passes its stderr logger. */
  log?: (message: string) => void;
}

/**
 * Fail loud when a run REQUIRES a capability the harness does not have, instead of silently
 * dropping the behavior the way `buildSessionMcpServers` did before. The one requirement worth
 * asserting today is tool delivery, the clearest case:
 *
 *  - Pi delivers tools through its native extension (not MCP), so a Pi run is exempt — its tool
 *    delivery never depends on the probed `mcpTools`/`toolCalls` flags.
 *  - Any other harness takes tools over MCP only. If the run carries tool specs but the harness
 *    does not advertise BOTH `mcpTools` (it can receive an MCP server) AND `toolCalls` (it can
 *    actually call a tool), those tools would be dropped without a trace. Refuse the run with a
 *    specific error, mirroring the `*_UNSUPPORTED_MESSAGE` gates in `run-plan.ts`.
 *
 * Throws on violation; the engine catch turns the throw into `{ ok: false, error }`.
 */
export function assertRequiredCapabilities({
  harness,
  isPi,
  probed,
  toolSpecs,
  log = () => {},
}: AssertCapabilitiesInput): void {
  assert(
    typeof harness === "string" && harness.length > 0,
    "assertRequiredCapabilities requires a non-empty harness id",
  );
  const { capabilities, source } = probed;

  // Pi's tools ride its native extension, not the probed MCP capability — nothing to assert.
  if (isPi) return;

  const toolCount = toolSpecs.length;
  if (toolCount === 0) return;

  const missing: string[] = [];
  if (!capabilities.mcpTools) missing.push("mcpTools:false");
  if (!capabilities.toolCalls) missing.push("toolCalls:false");
  if (missing.length === 0) return;

  // A static guess that says a capability is missing is the weakest signal, but the run still
  // cannot deliver the tools, so it must fail rather than proceed and drop them. Note the source
  // in the log so a debugging operator knows the probe was unavailable.
  log(
    `capability gate: harness '${harness}' (${source}) lacks ${missing.join(", ")}; ` +
      `refusing a run with ${toolCount} tool(s) rather than dropping them`,
  );
  throw new Error(
    toolDeliveryUnsupportedMessage(harness, missing.join(", "), toolCount),
  );
}
