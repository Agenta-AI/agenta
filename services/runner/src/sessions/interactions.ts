/**
 * Fire-and-forget interaction ingest.
 *
 * Posts a single interaction to /sessions/interactions authenticated AS the invoke caller.
 * Idempotent on the server (unique constraint on project+session+token), so retries are safe.
 */
import { fetchControlPlane } from "./control-plane-fetch.ts";
import { apiBase } from "../apiBase.ts";
import type { StoredPermissionDecision } from "../permission-plan.ts";
import { approvalKeyDigest, approvedCallKey } from "../responder.ts";

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
  "workflow" | "workflow_variant" | "workflow_revision";

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
    request: {
      tool,
      args,
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    },
    references: buildWorkflowReferences(request.runContext?.workflow),
    parameters:
      parameters && Object.keys(parameters).length ? parameters : undefined,
  };
}

/** Attempts at most for one interaction; each is safe to repeat (the API dedupes on the token). */
const INGEST_MAX_ATTEMPTS = 3;

function log(msg: string): void {
  process.stderr.write(`[sessions/interactions] ${msg}\n`);
}

/**
 * POST one interaction to the ingest endpoint, asked again on a failure of any kind, within one
 * control-plane budget for all attempts together. The API deduplicates on the session and the
 * `token`, so a repeat after a lost answer creates nothing new. Never throws: swallows on final
 * failure after logging.
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
  let failure: string;
  try {
    const res = await fetchControlPlane(
      (signal) =>
        fetch(url, {
          method: "POST",
          signal,
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
        }),
      { retryFailures: true, maxAttempts: INGEST_MAX_ATTEMPTS },
    );
    if (res.ok) {
      log(`ingest OK session=${sessionId} token=${token} kind=${kind}`);
      return;
    }
    failure = `HTTP ${res.status}`;
  } catch (err) {
    failure = String(err instanceof Error ? err.message : err);
  }
  log(`DROPPED session=${sessionId} token=${token}: ${failure.slice(0, 120)}`);
}

/**
 * The runner consumed a stored decision and is forwarding it to the harness: transition the
 * interaction to `resolved` (the API guard allows pending|responded -> resolved, covering
 * both the /interactions and messages planes). Single attempt; answers whether it landed, so
 * a caller that consumed a decision can say so when the row did NOT settle.
 */
export async function resolveInteraction(
  sessionId: string,
  token: string,
  auth: () => string,
  resolution?: InteractionResolution,
): Promise<boolean> {
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
    return true;
  } catch (err) {
    log(
      `resolve failed session=${sessionId} token=${token}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return false;
  }
}

/**
 * At the start of a new session turn, cancel prior turns' still-pending gates: if the user
 * sent a new message instead of answering a pending approval, that gate is orphaned. Spares
 * the current turn's own gates via `turn_id`, plus the parked gates a live resume carries
 * forward via `tokens`: they stay parked in the same process and still wait for an answer.
 * An answered gate is never pending (the person's answer moved it to `responded`), so the
 * sweep never touches it. Fire-and-forget, single attempt — best effort, never blocks the turn.
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

/**
 * How an answered row spells its decision. Three spellings are in the wild: the contract's
 * `verdict`, the `outcome` the playground's answer atom writes, and a bare `approved` boolean.
 * A reader that understands only one of them silently drops real answers.
 */
export type InteractionResolutionShape = {
  verdict?: unknown;
  outcome?: unknown;
  approved?: unknown;
};

/** One stored interaction row, as the query endpoint returns it. */
export type InteractionRow = {
  token?: string;
  kind?: string;
  status?: string;
  data?: {
    request?: { tool?: string; args?: unknown };
    resolution?: InteractionResolutionShape;
  } & Record<string, unknown>;
  resolution?: InteractionResolutionShape;
};

/**
 * The decision one resolution carries, or undefined when it carries none we trust.
 *
 * Strict at every spelling: the two string forms must be exactly `approved` or `denied`, and the
 * boolean form must be a real boolean. Nothing is inferred from absence — in particular there is
 * no "not denied means approved" path, because a row we cannot read must never widen access.
 */
function verdictOf(
  resolution: InteractionResolutionShape | undefined,
): "allow" | "deny" | undefined {
  if (!resolution || typeof resolution !== "object") return undefined;
  for (const spelling of [resolution.verdict, resolution.outcome]) {
    if (spelling === "approved") return "allow";
    if (spelling === "denied") return "deny";
    if (spelling !== undefined) return undefined;
  }
  if (resolution.approved === true) return "allow";
  if (resolution.approved === false) return "deny";
  return undefined;
}

/** Tolerate a bare array and the two wrapper shapes the query planes use. */
function interactionRowsOf(body: unknown): InteractionRow[] {
  if (Array.isArray(body)) return body as InteractionRow[];
  if (!body || typeof body !== "object") return [];
  const wrapped = body as { interactions?: unknown; items?: unknown };
  if (Array.isArray(wrapped.interactions))
    return wrapped.interactions as InteractionRow[];
  if (Array.isArray(wrapped.items)) return wrapped.items as InteractionRow[];
  return [];
}

/**
 * Read this session's durable interaction rows.
 *
 * Never throws: an unreachable interactions plane degrades to "no durable decisions", which
 * leaves the turn exactly where it was before this read existed rather than failing the run.
 */
export async function queryInteractions(
  sessionId: string,
  auth: () => string,
): Promise<InteractionRow[]> {
  // No retry ladder on a dead plane: this read sits on the turn's critical path. A throttled or
  // restarting plane is different, it said when to come back, so that wait is bounded and taken.
  try {
    const res = await fetchControlPlane(
      (signal) =>
        fetch(`${apiBase()}/sessions/interactions/query`, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            authorization: auth(),
          },
          // The filter is NESTED: the endpoint reads `body.query`, and a flat `session_id` is
          // silently ignored — which returns every interaction in the PROJECT, not this session's.
          body: JSON.stringify({ query: { session_id: sessionId } }),
        }),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = interactionRowsOf(await res.json());
    log(`query OK session=${sessionId} rows=${rows.length}`);
    return rows;
  } catch (err) {
    log(
      `query failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    return [];
  }
}

/** A durable row turned into the decision-map entry the gate consumes. */
export type SeededDecision = {
  key: string;
  decision: StoredPermissionDecision;
  token: string;
};

/**
 * The decision map the gate consumes, built from the rows this turn claimed. A FIFO list per
 * key, so two identical calls that were each answered each resolve from their own row.
 */
export function decisionMapOf(
  seeded: readonly SeededDecision[],
): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>();
  for (const entry of seeded) {
    const decisions = map.get(entry.key) ?? [];
    decisions.push(entry.decision);
    map.set(entry.key, decisions);
  }
  return map;
}

/**
 * The answered rows this session holds, as decision-map entries.
 *
 * Session scope is a security boundary, not a convenience: a row from ANOTHER session is another
 * conversation's human answer, and adopting it would authorize a call this session's user never
 * approved. The scope is enforced by the query's filter, so that filter must actually engage.
 *
 * Fail-closed at every step: only a `user_approval` row still in `responded` carries an answer
 * the turn has not already spent, and only a row naming its tool, its args, and a verdict can be
 * keyed to a specific call. Anything else is skipped rather than guessed at — a malformed row
 * must never widen what the agent may run.
 */
export function decisionsFromInteractionRows(
  rows: readonly InteractionRow[],
): SeededDecision[] {
  const seeded: SeededDecision[] = [];
  for (const row of rows) {
    if (row?.kind !== "user_approval" || row?.status !== "responded") continue;
    const token = row.token;
    if (!token) continue;
    const request = row.data?.request;
    if (!request || typeof request.tool !== "string" || !request.tool) continue;
    if (request.args === undefined || request.args === null) continue;
    const decision =
      verdictOf(row.data?.resolution) ?? verdictOf(row.resolution);
    if (!decision) continue;
    const key = approvedCallKey(request.tool, request.args);
    if (!key) continue;
    seeded.push({
      key,
      decision: { decision, interactionToken: token },
      token,
    });
  }
  return seeded;
}

/**
 * The approval answers one turn may use: the session's `responded` rows, read once before the
 * coordinator picks the warm or the cold path, and claimed at most once each.
 *
 * The row is the only source of an approval decision. An approval envelope in the request
 * messages is a copy of the row at best, and anyone who can put messages into a run request can
 * write one, so the runner never takes a verdict from message text alone. The warm resume asks
 * `verifiedDecision` (the envelope must agree with the row), and the cold gate takes `claimAll`.
 *
 * Claim, not read: a row is transitioned to `resolved` before its decision is handed back, and a
 * row that would not settle is dropped. A lost claim costs the user one re-approval; an unclaimed
 * row that stayed `responded` would let the next turn seed the same human answer again and run
 * the tool twice. The claims are memoized, so a warm resume that falls back to cold, or a stall
 * retry, keeps the answers this turn already claimed instead of asking the person again.
 */
export class TurnApprovalRows {
  private readonly answered: ReadonlyMap<string, SeededDecision>;
  private readonly claims = new Map<string, Promise<boolean>>();

  constructor(
    rows: readonly InteractionRow[],
    private readonly claimRow: (token: string) => Promise<boolean>,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.answered = new Map(
      decisionsFromInteractionRows(rows).map((entry) => [entry.token, entry]),
    );
  }

  /** No rows: a run with no session, or a plane that could not be read. Fails closed. */
  static empty(): TurnApprovalRows {
    return new TurnApprovalRows([], async () => false);
  }

  /**
   * The verdict an approval envelope may carry for this gate, or undefined.
   *
   * The envelope counts only when it names the gate's own row, that row is `responded`, the
   * verdicts agree, and the row's call (tool and arguments) is the gate's call. Anything else is
   * not an answer, and the gate keeps its card.
   */
  verifiedDecision(
    envelope: StoredPermissionDecision | undefined,
    gate: { interactionToken: string; toolName: string | undefined; args: unknown },
  ): "allow" | "deny" | undefined {
    const token = envelope?.interactionToken;
    if (!envelope || !token || token !== gate.interactionToken) return undefined;
    const row = this.answered.get(token);
    if (!row || row.decision.decision !== envelope.decision) return undefined;
    if (row.key !== approvedCallKey(gate.toolName, gate.args)) return undefined;
    return row.decision.decision;
  }

  /** Claim one answered row (`responded` to `resolved`). True only when this turn holds it. */
  claim(token: string): Promise<boolean> {
    if (!this.answered.has(token)) return Promise.resolve(false);
    let claim = this.claims.get(token);
    if (!claim) {
      claim = this.claimRow(token);
      this.claims.set(token, claim);
    }
    return claim;
  }

  /**
   * Every answered row of the session, claimed, ready to seed the cold gate. A row this turn
   * already claimed (on the warm path, or in an earlier attempt) is included again.
   *
   * Call this BEFORE `runTurn`. It performs I/O, and `runTurn` must not suspend before its
   * permission responder is attached — see the invariant at the top of that function.
   */
  async claimAll(): Promise<SeededDecision[]> {
    const claimed: SeededDecision[] = [];
    for (const entry of this.answered.values()) {
      if (await this.claim(entry.token)) {
        claimed.push(entry);
        continue;
      }
      this.log(
        `[HITL] durable decision NOT claimed, leaving the gate to re-raise: token=${entry.token} key=${approvalKeyDigest(entry.key)}`,
      );
    }
    return claimed;
  }
}

/**
 * Read this session's rows for one turn. No session or no credential means no rows, so the turn
 * takes no approval decision at all; a failed read does the same (`queryInteractions` degrades to
 * an empty list).
 */
export async function loadTurnApprovalRows(
  sessionId: string | undefined,
  credential: string | undefined,
  log: (msg: string) => void = () => {},
): Promise<TurnApprovalRows> {
  if (!sessionId || !credential) return TurnApprovalRows.empty();
  const auth = () => credential;
  const rows = await queryInteractions(sessionId, auth);
  return new TurnApprovalRows(
    rows,
    (token) => resolveInteraction(sessionId, token, auth),
    log,
  );
}
