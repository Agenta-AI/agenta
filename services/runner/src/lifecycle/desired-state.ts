/**
 * `DesiredEnvironmentState` — the request, normalized into semantic FACETS.
 *
 * LIFECYCLE MIGRATION, STEP 4. Kubernetes calls this the `spec`: what the caller wants. The
 * environment's `AppliedEnvironmentState` is the `status`: what it actually has. The router in
 * `reconciliation-router.ts` diffs one against the other.
 *
 * WHY FACETS. Today one `configFingerprint` hashes everything, so any change looks the same as
 * any other change and the only possible answer is a full rebuild. A facet is the smallest unit
 * that has ONE owner and ONE cheapest repair. Once the request is split this way, the router can
 * say "only the instructions moved, so refresh the workspace" instead of "something moved, so
 * rebuild the sandbox".
 *
 * LEVEL-TRIGGERED, AS AN INVARIANT. Every facet is computed from the CURRENT request alone. No
 * facet reads an event, a delta, or anything the runner remembers about how the state got here.
 * That is what level-triggered means, and it is why a missed turn, a dropped notification, or a
 * runner restart cannot corrupt a decision: the next request carries the whole desired state with
 * it. The property already held (the fingerprint travels with the request); this file states it
 * so a future change cannot quietly break it.
 *
 * SECRETS NEVER ENTER A FACET DIGEST. Credential VALUES are excluded exactly as
 * `configFingerprint` excludes them: the shape (binding and usage) identifies what kind of
 * credential it is, and the credential epoch owns rotation. A facet digest is logged, so a value
 * in one would be a leak.
 */
import { createHash } from "node:crypto";

import type { AgentRunRequest } from "../protocol.ts";

/**
 * The facets, in the order the reconciliation plan must apply them.
 *
 * The order is a real dependency order, not a naming convention. Changed harness files may need
 * both a workspace refresh AND a session reopen, and the refresh must land first or the reopened
 * session reads the old bytes.
 */
export const FACETS = [
  "sandbox",
  "runtime",
  "workspace",
  "harnessSession",
  "toolCatalog",
] as const;

export type Facet = (typeof FACETS)[number];

/** One digest per facet. Each is a hash, never content, so the whole object is safe to log. */
export type FacetDigests = Readonly<Record<Facet, string>>;

export interface DesiredEnvironmentState {
  readonly digests: FacetDigests;
  /** The whole-request fingerprint, kept so the shadow log can compare old and new decisions. */
  readonly configFingerprint: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON: object keys sorted, so a reordered request never looks like a change. */
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/** Strip credential VALUES, keeping only the shape. Mirrors `configFingerprint`. */
function credentialShapes(
  credentials: ReadonlyArray<{ binding?: unknown; usage?: unknown }> | undefined,
): unknown {
  return (credentials ?? []).map((c) => ({ binding: c.binding, usage: c.usage }));
}

/**
 * Normalize a request into facet digests.
 *
 * Every field below already lives in `configFingerprint`. This function does not add or remove
 * any input; it only says WHICH facet each input belongs to. So a request whose whole-request
 * fingerprint is unchanged always produces unchanged facet digests, and the shadow comparison in
 * step 4 is meaningful rather than noise.
 */
export function normalizeDesiredState(
  request: AgentRunRequest,
  configFingerprint: string,
): DesiredEnvironmentState {
  // SANDBOX: the provider instance and its immutable topology. A change here can only be a
  // rebuild, because there is nothing to reconfigure on a sandbox that is the wrong sandbox.
  // The harness is here rather than under `runtime` by product policy: switching harness rebuilds.
  const sandbox = canonical({
    provider: request.sandbox ?? null,
    harness: request.harness ?? null,
    sandboxPermission: request.sandboxPermission ?? null,
  });

  // RUNTIME: what is baked into the agent daemon at start. Model connection, process
  // environment, and credential SHAPES. Values are excluded; the credential epoch owns rotation.
  const runtime = canonical({
    connection: request.connection ?? null,
    modelConnection: request.modelConnection
      ? {
          provider: request.modelConnection.provider,
          deployment: request.modelConnection.deployment,
          endpoint: request.modelConnection.endpoint ?? null,
          credentialMode: request.modelConnection.credentialMode,
          environment: request.modelConnection.environment ?? null,
          credentials: credentialShapes(request.modelConnection.credentials),
        }
      : null,
  });

  // WORKSPACE: the managed files the runner writes into the run directory. These can be
  // rewritten in place on a live sandbox, which is why they are their own facet.
  const workspace = canonical({
    agentsMd: request.agentsMd ?? null,
    systemPrompt: request.systemPrompt ?? null,
    appendSystemPrompt: request.appendSystemPrompt ?? null,
    skills: request.skills ?? null,
    harnessFiles: request.harnessFiles ?? null,
  });

  // HARNESS SESSION: what is fixed when the ACP session opens. The model and the harness mode
  // are here because a live `setModel` is a session-level operation, not a daemon restart.
  // User MCP servers are here because the server LIST is only read at session initialization.
  const harnessSession = canonical({
    model: request.model ?? null,
    harnessMode: request.harnessMode ?? null,
    modelCapabilities: request.modelCapabilities ?? null,
    permissions: request.permissions ?? null,
    mcpServers:
      request.mcpServers?.map((server) => ({
        ...server,
        connection: {
          ...server.connection,
          credentials: credentialShapes(server.connection?.credentials),
        },
      })) ?? null,
  });

  // TOOL CATALOG: what the model can see and call. It is its own facet because it is the one
  // the adapters could eventually apply live. v1 routes it to a session reopen on every harness.
  const toolCatalog = canonical({
    customTools: request.customTools ?? null,
    toolCallbackEndpoint: request.toolCallback?.endpoint ?? null,
  });

  return {
    configFingerprint,
    digests: {
      sandbox: sha256(sandbox),
      runtime: sha256(runtime),
      workspace: sha256(workspace),
      harnessSession: sha256(harnessSession),
      toolCatalog: sha256(toolCatalog),
    },
  };
}

/** The facets whose digests differ. Returns them in `FACETS` order. */
export function changedFacets(
  desired: FacetDigests,
  applied: FacetDigests | undefined,
): Facet[] {
  if (!applied) return [...FACETS];
  return FACETS.filter((facet) => desired[facet] !== applied[facet]);
}
