import type { NodeTier } from "../../model/types";

/**
 * Cosmetic-only grouping metadata for the two synthetic container boxes
 * introduced by scripts/layout.mjs (grp-runner, grp-pi-harness). Keep this
 * in sync with the GROUPS constant in scripts/layout.mjs by hand: the script
 * decides which real nodes sit inside which box (baked into positions.json's
 * parentId field); this file only supplies the label/tier used to render
 * the box itself, since group ids are not present in nodes.json.
 */
export const GROUP_META: Record<string, { label: string; tier: NodeTier }> = {
  "grp-runner": { label: "Agent Runner Sidecar (in-process)", tier: "runner" },
  "grp-pi-harness": { label: "Pi CLI process", tier: "sandbox" },
};

/** Subtle alias hints shown under a node's label (PLAN.md: runner's "a.k.a." note). */
export const ALIAS_HINTS: Record<string, string> = {
  runner: "a.k.a. sandbox-agent",
};

/**
 * Cosmetic-only classification of edges.json into the one "primary request
 * spine" -- browser -> gateway -> agent service -> runner -> daemon -> ACP
 * adapters -> harnesses -- vs. every other (still real) interaction: tool
 * resolution/execution, secrets, tracing, session bookkeeping, the relay,
 * the MCP bridge, and the response/streaming return path. Drives buildFlow's
 * edge "kind" so the spine reads as the one prominent solid path and
 * everything else stays muted until hovered/selected. Keep this in sync by
 * hand if edges.json's ids ever change; it is not derived from the model.
 */
export const SPINE_EDGE_IDS = new Set<string>([
  "e-browser-gateway",
  "e-gateway-agent-service",
  "e-agent-service-runner",
  "e-runner-sandbox-agent-daemon",
  "e-daemon-acp-pi",
  "e-daemon-acp-claude",
  "e-acp-pi-harness-pi",
  "e-acp-claude-harness-claude",
]);
