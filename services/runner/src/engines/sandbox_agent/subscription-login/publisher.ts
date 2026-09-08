/**
 * Getting a refreshed login home.
 *
 * Pi refreshes its own OAuth token mid-turn and writes the new pair into the run's agent dir. That
 * written file is the ONLY copy: the delivered refresh token has been spent and the provider
 * rotated it away. A session that dies with an unpublished refresh takes the live credential with
 * it, and the next run starts from a token the provider will refuse.
 *
 * ONE OPERATION PUBLISHES, AND IT IS ACKNOWLEDGEMENT-BASED. A reconciliation pass reads the file
 * and publishes whatever the API has not acknowledged yet. It runs once at start (which repairs a
 * publication a previous session lost), on an interval while the session lives, whenever recovery
 * asks for it, and one last time on shutdown. Nothing else publishes, so there is no change event
 * to lose: a pass that fails leaves the credential unacknowledged and the next pass sends it again.
 *
 * NEVER LOG THE CREDENTIAL. The event fields are decision words, generations, and HTTP statuses.
 */
import { createHash } from "node:crypto";

import {
  observeSubscription,
  thrownFields,
} from "../../../subscription-events.ts";
import {
  loginExpires,
  readSubscriptionLoginForRun,
  type LocalSubscriptionFileDeps,
  type SubscriptionSandboxFs,
} from "./files.ts";
import { validateSubscriptionLogin } from "./validate.ts";
import type {
  ModelConnectionSubscription,
  SubscriptionLogin,
} from "../../../protocol.ts";

type Log = (message: string) => void;

/** How long the runner waits on one push or failure report before giving up on it. */
const SUBSCRIPTION_API_TIMEOUT_MS = 10_000;

/** How often a local session reconciles its login file. */
export const LOCAL_RECONCILE_INTERVAL_MS = 5_000;

/**
 * How often a Daytona session does. Longer because every pass is a sandbox file API round trip,
 * and short next to a turn.
 */
export const DAYTONA_RECONCILE_INTERVAL_MS = 30_000;

function defaultLog(message: string): void {
  process.stderr.write(`[sandbox_agent/subscription-login] ${message}\n`);
}

/**
 * The credential the API has already answered for: a lineage plus a refresh-token identity.
 *
 * Expiry cannot play this role. The provider rotates the refresh token on every exchange and the
 * API accepts a rotation with an EQUAL expiry, so an expiry floor silently drops one. The token
 * itself is hashed rather than kept, so the identity is comparable without holding a second copy of
 * a secret.
 */
type CredentialIdentity = string;

function credentialIdentity(
  generation: number,
  login: SubscriptionLogin,
): CredentialIdentity {
  const refresh = typeof login.refresh === "string" ? login.refresh : "";
  return `${generation}:${createHash("sha256").update(refresh).digest("hex")}`;
}

export interface SubscriptionPublishState {
  /**
   * The lineage and the version this run is running on. A push quotes them, and so does a failure
   * report, which is the only way the API can tell "a refresh I already have" from "a sign-in that
   * replaced this one". They move only when a recovery adopts a newer login the API handed back.
   */
  generation: number;
  version: number;
  /**
   * The credential identity that needs no publication: the API answered for it, or the runner
   * refused to send it. Anything else on disk is published on the next pass.
   */
  acknowledged: CredentialIdentity | undefined;
}

export function subscriptionPublishState(
  subscription: ModelConnectionSubscription,
): SubscriptionPublishState {
  return {
    generation: subscription.generation,
    version: subscription.version,
    // The API delivered this login, so it plainly holds it.
    acknowledged: credentialIdentity(
      subscription.generation,
      subscription.login,
    ),
  };
}

/**
 * Record that this run now runs on `login`, and that the API already holds it. The one caller is
 * the recovery path adopting a login the API handed back.
 */
export function adoptSubscriptionLogin(
  state: SubscriptionPublishState,
  generation: number,
  version: number,
  login: SubscriptionLogin,
): void {
  state.generation = generation;
  state.version = version;
  state.acknowledged = credentialIdentity(generation, login);
}

export interface SubscriptionApiDeps {
  apiBase: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: Log;
}

/** Which moment asked for a pass. A log field, so a publication can be traced to its cause. */
export type PublishTrigger =
  | "start"
  | "interval"
  | "recovery"
  | "shutdown";

/**
 * A running publisher. `stop` drains and is idempotent; neither method ever rejects.
 */
export interface SubscriptionPublisher {
  /** Publish anything the API has not acknowledged. Passes are serialized. */
  reconcile: (trigger: PublishTrigger) => Promise<void>;
  /** Await the pass in flight, take one final sample, and stop reconciling. */
  stop: () => Promise<void>;
}

/**
 * Start the one publisher for a session. Undefined for a run that carries no subscription, no
 * agent dir, or no run credential to authorize the push with.
 *
 * `sandbox` is read at each pass rather than captured: a Daytona sandbox is acquired after the
 * publisher starts, and it is gone before the publisher's last pass would otherwise run.
 */
export function startSubscriptionPublisher(input: {
  plan: {
    isDaytona: boolean;
    credentials: {
      subscription?: ModelConnectionSubscription;
      subscriptionHome?: string;
    };
  };
  state: SubscriptionPublishState | undefined;
  sandbox: () => unknown;
  apiBase: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: Log;
  intervalMs?: number;
  fileDeps?: LocalSubscriptionFileDeps;
}): SubscriptionPublisher | undefined {
  const subscription = input.plan.credentials.subscription;
  const home = input.plan.credentials.subscriptionHome;
  const state = input.state;
  const log = input.log ?? defaultLog;
  if (!subscription || !home || !state || !input.authorization) {
    if (subscription) {
      observeSubscription(log, "subscription.publish", {
        connection: subscription.id,
        trigger: "start",
        decision: "not-wired",
        home: home ? "yes" : "no",
        state: state ? "yes" : "no",
        credential: input.authorization ? "yes" : "no",
      });
    }
    return undefined;
  }
  const isDaytona = input.plan.isDaytona;
  const api: SubscriptionApiDeps = {
    apiBase: input.apiBase,
    authorization: input.authorization,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    log,
  };

  const pass = async (trigger: PublishTrigger): Promise<void> => {
    const sandbox = input.sandbox() as SubscriptionSandboxFs | undefined;
    // A Daytona run before its sandbox exists, or after it is released, has no file to read.
    if (isDaytona && !sandbox) return;
    let login: SubscriptionLogin | undefined;
    try {
      login = await readSubscriptionLoginForRun({
        home,
        isDaytona,
        ...(sandbox ? { sandbox } : {}),
        ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
      });
    } catch (err) {
      observeSubscription(log, "subscription.publish", {
        connection: subscription.id,
        trigger,
        decision: "unreadable",
        ...thrownFields(err),
      });
      return;
    }
    if (!login) return;
    const identity = credentialIdentity(state.generation, login);
    if (identity === state.acknowledged) return;
    const verdict = validateSubscriptionLogin(login);
    if (!verdict.ok) {
      // A login that fails this check fails it every time, so settling it keeps a broken file from
      // being re-read and re-refused on every tick. Pi's next refresh writes a new identity.
      state.acknowledged = identity;
      observeSubscription(log, "subscription.publish", {
        connection: subscription.id,
        trigger,
        generation: state.generation,
        decision: "refused",
        reason: verdict.reason,
      });
      return;
    }
    const answered = await pushLogin(subscription, state, login, trigger, api);
    if (answered) state.acknowledged = identity;
  };

  let queue: Promise<void> = Promise.resolve();
  let queuedTick = false;
  let released = false;
  const reconcile = (trigger: PublishTrigger): Promise<void> => {
    if (released) return Promise.resolve();
    // One pass at a time, and a caller that arrives during a pass gets its OWN pass: the running
    // one may have read the file before their write.
    queue = queue.then(() => pass(trigger)).catch(() => {});
    return queue;
  };

  const timer = setInterval(
    () => {
      // A slow API must not let passes pile up: one queued tick is enough.
      if (queuedTick) return;
      queuedTick = true;
      void reconcile("interval").finally(() => {
        queuedTick = false;
      });
    },
    input.intervalMs ??
      (isDaytona ? DAYTONA_RECONCILE_INTERVAL_MS : LOCAL_RECONCILE_INTERVAL_MS),
  );
  timer.unref?.();

  let stopping: Promise<void> | undefined;
  const stop = async (): Promise<void> => {
    clearInterval(timer);
    // The final sample runs AFTER the in-flight pass, so a refresh written during it is still seen.
    await queue.catch(() => {});
    await pass("shutdown").catch(() => {});
    released = true;
  };

  // The start pass repairs a publication a previous session lost: the agent dir can already hold a
  // login newer than the delivered one, whose push never reached the API.
  void reconcile("start");

  return {
    reconcile,
    stop: () => (stopping ??= stop()),
  };
}

/**
 * Send one login to the API. Answers true when the API judged it, which is what lets the runner
 * stop retrying: a 4xx other than 408 and 429 is the API's decision and repeating the same body
 * cannot change it, while a timeout, a network failure, and a 5xx leave the credential
 * unacknowledged for the next pass.
 *
 * A push NEVER fails the turn. The run already succeeded and the harness still holds the working
 * token in its own process; the cost of a lost push is one extra refresh later.
 */
async function pushLogin(
  subscription: ModelConnectionSubscription,
  state: SubscriptionPublishState,
  login: SubscriptionLogin,
  trigger: PublishTrigger,
  deps: SubscriptionApiDeps,
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = `${deps.apiBase}/secrets/${encodeURIComponent(subscription.id)}/subscription-login`;
  const event = {
    connection: subscription.id,
    trigger,
    generation: state.generation,
  };
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      // `version` is what this run was delivered. The API orders by generation and expiry and does
      // not read it as a precondition; it stays on the wire because the route declares it.
      body: JSON.stringify({
        login,
        version: state.version,
        generation: state.generation,
      }),
      signal: AbortSignal.timeout(SUBSCRIPTION_API_TIMEOUT_MS),
    });
    if (!res.ok) {
      const retryable =
        res.status >= 500 || res.status === 408 || res.status === 429;
      // The body can carry the API's own account and version detail; only the status is recorded.
      observeSubscription(log, "subscription.publish", {
        ...event,
        decision: retryable ? "unanswered" : "rejected",
        status: res.status,
      });
      return !retryable;
    }
    const body = (await res.json().catch(() => ({}))) as {
      version?: unknown;
      updated?: unknown;
      stale?: unknown;
      reason?: unknown;
    };
    observeSubscription(log, "subscription.publish", {
      ...event,
      decision:
        body.updated === false ? (body.stale === true ? "stale" : "refused") : "updated",
      version: typeof body.version === "number" ? body.version : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      status: res.status,
    });
    return true;
  } catch (err) {
    observeSubscription(log, "subscription.publish", {
      ...event,
      decision: "unanswered",
      ...thrownFields(err),
    });
    return false;
  }
}

/**
 * Tell the API that this run's login was refused, and ask whether a newer one exists.
 *
 * `stale: true` means the stored login moved on while this run held an old one, which is a retry
 * rather than a re-login. Anything else, a call that fails outright included, is treated as "the
 * login is dead": offering a sign-in the user does not need costs a click, while offering a retry
 * against a dead login loops forever.
 */
export interface SubscriptionFailureReport {
  stale: boolean;
  /** The login the API holds instead, present only on a stale answer. */
  login?: SubscriptionLogin;
  version?: number;
  generation?: number;
}

export async function reportSubscriptionLoginFailure(
  subscription: ModelConnectionSubscription,
  state: SubscriptionPublishState,
  reason: string,
  deps: SubscriptionApiDeps,
): Promise<SubscriptionFailureReport> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = `${deps.apiBase}/secrets/${encodeURIComponent(subscription.id)}/subscription-login/failure`;
  const event = {
    connection: subscription.id,
    generation: state.generation,
    version: state.version,
    reason,
  };
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      // What was DELIVERED to this run, which is what asks "was the login I ran on superseded?".
      body: JSON.stringify({
        version: state.version,
        generation: state.generation,
        reason,
      }),
      signal: AbortSignal.timeout(SUBSCRIPTION_API_TIMEOUT_MS),
    });
    if (!res.ok) {
      observeSubscription(log, "subscription.recovery", {
        ...event,
        decision: "report-failed",
        status: res.status,
      });
      return { stale: false };
    }
    const body = (await res.json().catch(() => ({}))) as {
      stale?: unknown;
      login?: unknown;
      version?: unknown;
      generation?: unknown;
    };
    const stale = body.stale === true;
    const report: SubscriptionFailureReport = { stale };
    // Only from a STALE answer. A non-stale body has no newer login to offer, and adopting anything
    // it did carry would overwrite the file with the credential just proved dead.
    if (stale && loginExpires(body.login) !== undefined) {
      report.login = body.login as SubscriptionLogin;
    }
    if (typeof body.version === "number") report.version = body.version;
    if (typeof body.generation === "number") report.generation = body.generation;
    observeSubscription(log, "subscription.recovery", {
      ...event,
      decision: stale ? "stale" : "dead",
      recovered: report.login !== undefined,
      status: res.status,
    });
    return report;
  } catch (err) {
    observeSubscription(log, "subscription.recovery", {
      ...event,
      decision: "report-failed",
      ...thrownFields(err),
    });
    return { stale: false };
  }
}
