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
import { normalizedHarnessMode } from "../harness-kind.ts";

/**
 * The facets, in the order the reconciliation plan must apply them.
 *
 * The order is a real dependency order, not a naming convention. Changed harness files may need
 * both a workspace refresh AND a session reopen, and the refresh must land first or the reopened
 * session reads the old bytes.
 *
 * GRANULARITY IS A SAFETY PROPERTY, NOT A STYLE CHOICE. A facet is the unit the router routes, so
 * a facet that mixes two concerns forces the cheaper route onto both. The first three facets here
 * were split out of one coarse `workspace` facet and one coarse `harnessSession` facet precisely
 * because making those live would have routed harness permission files through an in-place
 * refresh, and a permissions change through `setModel` — both of which `adapter-matrix.md`
 * forbids by name. When in doubt, split: an over-fine facet costs an unnecessary rebuild, while
 * an over-coarse one silently downgrades a security-relevant change.
 */
export const FACETS = [
  "sandbox",
  "runtime",
  "workspaceFiles",
  "prompts",
  "harnessFiles",
  "model",
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
  credentials:
    | ReadonlyArray<{ binding?: unknown; usage?: unknown }>
    | undefined,
): unknown {
  return (credentials ?? []).map((c) => ({
    binding: c.binding,
    usage: c.usage,
  }));
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
    // The agent artifact id lives here because the mount it selects is created with the
    // sandbox and has no live remount route: a changed (or newly present) id can only be
    // served by a rebuild (audit finding 4). The rest of `runContext` stays out of every
    // facet — it is per-turn metadata.
    agentArtifactId: request.runContext?.workflow?.artifact?.id?.trim() || null,
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
    sandboxCredentials:
      request.sandboxCredentials?.map((credential) => ({ binding: credential.binding })) ?? null,
  });

  // WORKSPACE FILES: the managed files the runner writes and OWNS. Instructions and skills only.
  // It is deliberately the narrowest of the four the old `workspace` facet used to contain,
  // because it is the one whose files the runner may rewrite on a live sandbox. Rewriting them is
  // NOT enough to make a running harness observe them, so the facet escalates today; see the
  // capability table in `reconciliation-router.ts`.
  const workspaceFiles = canonical({
    agentsMd: request.agentsMd ?? null,
    skills: request.skills ?? null,
  });

  // PROMPTS: the authored system and append prompts. SDK-owned `platformInstructions` and legacy
  // `gatewayGuidance` are deliberately absent here and from every other facet (mirroring
  // `configFingerprint`): the runner splices generated text at build time, and it never causes an
  // otherwise reusable warm environment to be replaced.
  //
  // SEPARATE FROM `workspaceFiles`, and not live. For Pi these land as files under the agent
  // directory, and the adapter matrix records active-session observation as NOT GUARANTEED: a
  // running process may have captured their location or content already. Refreshing them and
  // claiming the model saw the change would be a lie, so a prompt change escalates.
  const prompts = canonical({
    systemPrompt: request.systemPrompt ?? null,
    appendSystemPrompt: request.appendSystemPrompt ?? null,
  });

  // HARNESS FILES: opaque, harness-rendered configuration files.
  //
  // SEPARATE FROM `workspaceFiles`, and never live. `adapter-matrix.md` section 4.3.2 rule 3 is
  // explicit: harness PERMISSION files join permission tightening and credential revocation on
  // the list of changes that must never take the apply-live route. The runner cannot tell a
  // permission file from any other harness file — they are opaque by construction — so the whole
  // facet escalates. Folding these in with instructions would silently route a security-relevant
  // change through an in-place refresh.
  const harnessFiles = canonical({
    harnessFiles: request.harnessFiles ?? null,
  });

  // MODEL: the requested model id, ALONE.
  //
  // Its own facet because it is the one session-level change with a real live path: `setModel`
  // on the running session. Everything else that is fixed at session open stays in
  // `harnessSession` below and escalates.
  const model = canonical({ model: request.model ?? null });

  // HARNESS SESSION: everything else fixed when the ACP session opens. None of it is live.
  //
  // `permissions` is here rather than beside `model` for the same reason `harnessFiles` is its
  // own facet: section 1.4 exempts permission TIGHTENING from apply-live entirely, and it must
  // take effect or fail closed before execution continues. `mcpServers` is here because the
  // server LIST is only read at session initialization and no live API exists on any harness.
  // No `modelCapabilities`: it is per-turn data (the attachment chain reads the incoming
  // request every turn) and it changes WITH the model, so hashing it here made a cross-modality
  // model switch move `harnessSession` beside `model` and refuse the live route (audit finding 2).
  const harnessSession = canonical({
    // The SHARED normalizer, not the raw field (audit finding 3): the fingerprint normalizes
    // the Codex mode, and a facet that took it raw could move while the fingerprint stayed
    // still — poisoning every later plan for that session into a rebuild.
    harnessMode: normalizedHarnessMode(request.harness, request.harnessMode),
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
  // No `toolCallback.endpoint` (audit finding 5): it is read from the incoming request every
  // turn, so it is per-turn routing, not environment identity.
  const toolCatalog = canonical({
    customTools: request.customTools ?? null,
  });

  return {
    configFingerprint,
    digests: {
      sandbox: sha256(sandbox),
      runtime: sha256(runtime),
      workspaceFiles: sha256(workspaceFiles),
      prompts: sha256(prompts),
      harnessFiles: sha256(harnessFiles),
      model: sha256(model),
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
