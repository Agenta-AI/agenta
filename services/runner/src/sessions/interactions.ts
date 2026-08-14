/**
 * Fire-and-forget interaction ingest.
 *
 * Posts a single interaction to /sessions/interactions authenticated AS the invoke caller.
 * Idempotent on the server (unique constraint on project+session+token), so retries are safe.
 */
import { apiBase } from "../apiBase.ts";

export type InteractionKind = "user_approval" | "user_input" | "client_tool";

export type InteractionResolution = {
  verdict: "approved" | "denied";
  tool_call_id: string;
};

/** A platform entity reference (the API `Reference` shape). */
type Reference = { id?: string; slug?: string; version?: string };

/**
 * Which of the three workflow entities a reference names. Spelled `key`, matching the
 * reference lists evaluation runs already store.
 */
export type ReferenceKey =
  | "workflow"
  | "workflow_variant"
  | "workflow_revision";

/**
 * A reference that still says which entity it names after it leaves the keyed map. Stored
 * reference lists are flat, so without this a reader can only guess which id is the workflow.
 */
export type TypedReference = Reference & { key: ReferenceKey };

/** The run's workflow identity: the artifact (the workflow), its variant, and its revision. */
type WorkflowIdentity = {
  artifact?: Reference;
  variant?: Reference;
  revision?: Reference;
};

/**
 * The gated call a durable interaction row describes.
 *
 * `tool_call_id` is the HARNESS's id for the call, which the interaction `token` is not — the
 * token is the permission gate's id. The live `interaction_request` event carries both, which is
 * why the playground can answer correctly; a caller working from the stored row alone needs the
 * tool-call id here or it names the wrong call. Optional: rows written before this field exist
 * carry only the token, and every reader must tolerate that.
 */
export type InteractionRequest = {
  tool: string;
  args: unknown;
  tool_call_id?: string;
};

export type InteractionData = {
  request?: InteractionRequest;
  // Optional attribution for out-of-band re-invocation; inbox/audit rows exist without it.
  references?: Record<string, Reference>;
  /**
   * The effective config the gated turn was running (the SDK's `effectiveParameters`, opaque
   * here). A client answering this gate replays it as the invoke's `data.parameters`, which
   * suppresses reference hydration server-side and reproduces the turn — most importantly its
   * tool permissions. Absent on rows written before this field existed, and on turns whose
   * config was too large or unsafe to stamp; those resume via `references` alone, as before.
   */
  parameters?: Record<string, unknown>;
};

/** Build the invoke `references` from the runner's run-context workflow identity. */
export function buildWorkflowReferences(
  workflow: WorkflowIdentity | undefined,
): Record<string, Reference> | undefined {
  if (!workflow) return undefined;
  const refs: Record<string, Reference> = {};
  if (workflow.artifact) refs.workflow = workflow.artifact;
  if (workflow.variant) refs.workflow_variant = workflow.variant;
  if (workflow.revision) refs.workflow_revision = workflow.revision;
  return Object.keys(refs).length ? refs : undefined;
}

/**
 * The same identity as the flat list every PERSISTED shape uses (the turn-ledger append, the
 * session heartbeat), each element carrying the family key it was stored under. That key is the
 * only place the family lives, so serializing the map's values alone strands the reader with
 * bare uuids and no way to tell the workflow from its variant.
 */
export function buildWorkflowReferenceList(
  workflow: WorkflowIdentity | undefined,
): TypedReference[] | undefined {
  const refs = buildWorkflowReferences(workflow);
  if (!refs) return undefined;
  return Object.entries(refs).map(([key, reference]) => ({
    ...reference,
    key: key as ReferenceKey,
  }));
}

/**
 * The durable `data` for one gate: what was asked, who to attribute it to, and what config the
 * turn ran under. The two attribution fields are omitted (not null, not `{}`) when the request
 * carries neither, so a legacy row's shape is exactly what it was before this field existed.
 */
export function buildInteractionData(
  request: {
    runContext?: { workflow?: WorkflowIdentity };
    effectiveParameters?: Record<string, unknown>;
  },
  tool: string,
  args: unknown,
  toolCallId?: string,
): InteractionData {
  const parameters = request.effectiveParameters;
  return {
    // The gate id (`token`) and the harness's tool-call id differ; an out-of-band answer
    // needs the latter to name the call it is answering.
    request: { tool, args, ...(toolCallId ? { tool_call_id: toolCallId } : {}) },
    references: buildWorkflowReferences(request.runContext?.workflow),
    parameters:
      parameters && Object.keys(parameters).length ? parameters : undefined,
  };
}

const INGEST_MAX_RETRIES = 3;
const INGEST_RETRY_BASE_MS = 100;

function log(msg: string): void {
  process.stderr.write(`[sessions/interactions] ${msg}\n`);
}

/**
 * POST one interaction to the ingest endpoint with bounded retry.
 * Never throws — swallows on final failure after logging.
 */
export async function createInteraction(
  sessionId: string,
  turnId: string,
  token: string,
  kind: InteractionKind,
  data: InteractionData,
  auth: () => string,
): Promise<void> {
  const url = `${apiBase()}/sessions/interactions/`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= INGEST_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: auth(),
        },
        body: JSON.stringify({
          session_id: sessionId,
          turn_id: turnId,
          token,
          kind,
          data,
          flags: { delivered_in_band: true },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      log(`ingest OK session=${sessionId} token=${token} kind=${kind}`);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, INGEST_RETRY_BASE_MS * attempt));
    }
  }
  log(
    `DROPPED session=${sessionId} token=${token} after ${INGEST_MAX_RETRIES} retries: ${String(lastErr instanceof Error ? lastErr.message : lastErr).slice(0, 120)}`,
  );
}

/**
 * The runner consumed a stored decision and is forwarding it to the harness: transition the
 * interaction to `resolved` (the API guard allows pending|responded -> resolved, covering
 * both the /interactions and messages planes). Fire-and-forget, single attempt.
 */
export async function resolveInteraction(
  sessionId: string,
  token: string,
  auth: () => string,
  resolution?: InteractionResolution,
): Promise<void> {
  try {
    const res = await fetch(`${apiBase()}/sessions/interactions/transition`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth() },
      body: JSON.stringify({
        session_id: sessionId,
        token,
        status: "resolved",
        ...(resolution ? { resolution } : {}),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log(`resolve OK session=${sessionId} token=${token}`);
  } catch (err) {
    log(
      `resolve failed session=${sessionId} token=${token}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
  }
}

/**
 * At the start of a new session turn, cancel prior turns' still-pending gates: if the user
 * sent a new message instead of answering a pending approval, that gate is orphaned. Spares
 * the current turn's own gates via `turn_id`, plus any prior-turn gates this turn answers
 * in-band via `tokens` — an in-band answer never transitioned the row off `pending` (only the
 * interactions-plane respond endpoint does), and the resume resolves it after consuming the
 * decision; sweeping it first would record the granted gate as `cancelled` and 404 the
 * resolve. Fire-and-forget, single attempt — best effort, never blocks the turn.
 */
export async function cancelStaleInteractions(
  sessionId: string,
  turnId: string,
  tokens: string[] | undefined,
  auth: () => string,
): Promise<void> {
  try {
    const res = await fetch(`${apiBase()}/sessions/interactions/cancel-stale`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth() },
      body: JSON.stringify({
        session_id: sessionId,
        turn_id: turnId,
        ...(tokens?.length ? { tokens } : {}),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log(`cancel-stale OK session=${sessionId} turn=${turnId}`);
  } catch (err) {
    log(
      `cancel-stale failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
  }
}
