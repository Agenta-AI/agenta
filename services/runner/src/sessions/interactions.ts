/**
 * Fire-and-forget interaction ingest.
 *
 * Posts a single interaction to /sessions/interactions authenticated AS the invoke caller.
 * Idempotent on the server (unique constraint on project+session+token), so retries are safe.
 */
import { apiBase } from "../apiBase.ts";

export type InteractionKind = "user_approval" | "user_input" | "client_tool";

/** A platform entity reference (the API `Reference` shape). */
type Reference = { id?: string; slug?: string; version?: string };

export type InteractionData = {
  request?: { tool: string; args: unknown };
  // The workflow references that identify which revision THIS turn is running, so the
  // respond invoke re-resolves the SAME workflow. We store the references (pointers), not
  // the revision data itself — respond resolves the live revision from them at invoke time.
  references?: Record<string, Reference>;
};

/** Build the invoke `references` from the runner's run-context workflow identity. */
export function buildWorkflowReferences(
  workflow:
    | {
        artifact?: Reference;
        variant?: Reference;
        revision?: Reference;
      }
    | undefined,
): Record<string, Reference> | undefined {
  if (!workflow) return undefined;
  const refs: Record<string, Reference> = {};
  if (workflow.artifact) refs.workflow = workflow.artifact;
  if (workflow.variant) refs.workflow_variant = workflow.variant;
  if (workflow.revision) refs.workflow_revision = workflow.revision;
  return Object.keys(refs).length ? refs : undefined;
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
): Promise<void> {
  try {
    const res = await fetch(`${apiBase()}/sessions/interactions/transition`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth() },
      body: JSON.stringify({
        session_id: sessionId,
        token,
        status: "resolved",
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
