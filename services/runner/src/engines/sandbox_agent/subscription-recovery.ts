/**
 * What the runner does when a hosted subscription run says its login was refused.
 *
 * The old behavior was one step: report the failure and show the user an error. Amendments A1 and
 * A2 of the implementation contract replace it with a decision the runner makes for itself, and
 * this module is that decision. Nothing here streams, tears down, or retries — it answers ONE
 * question, "retry or fail, and with which copy", and leaves the acting to the turn path.
 *
 * THE ORDER MATTERS, AND IT IS NOT THE OBVIOUS ONE.
 *
 * 1. ASK THE PROVIDER FIRST, NOT THE API (A2). Pi reports the same sentence for a dead login and
 *    for a refresh that lost a race, timed out, or hit a 500. Reporting the first as the second
 *    marks a healthy connection `needs_login` and sends the user through a device sign-in they did
 *    not need. So the runner exchanges the LOCAL refresh token itself, through the same client
 *    function Pi uses, and reads the provider's own answer:
 *      - the exchange SUCCEEDS -> the login was never dead. Keep the new pair, publish it, retry.
 *      - the provider REFUSES it (400/401 invalid_grant, refresh_token_*) -> terminal.
 *      - the call cannot complete (network, 5xx, 429) -> nothing is known. Mark NOTHING.
 * 2. ONLY THEN ASK THE API (A1). A terminal refusal still has one innocent explanation: another
 *    session signed in again and this run is holding the previous login. The failure report is
 *    what distinguishes them, because only the API knows what it stores. A `stale` answer carries
 *    the current login, which the runner materializes and retries on.
 * 3. RETRY ONLY WHAT IS SAFE TO REPLAY (A1.3). A turn that already streamed text or ran a tool has
 *    side effects the user has seen. It is never replayed; it fails retryably instead, and the
 *    next message picks up the recovered login.
 *
 * NOTHING HERE LOGS A CREDENTIAL. Not the token, not the refresh token, not the provider's error
 * body — that body is the request echoed back and it carries the refresh token. The log vocabulary
 * is a decision word, an outcome word, and an HTTP status.
 */
import {
  isSubscriptionAuthFailure,
  subscriptionAuthError,
  subscriptionAuthFailureReason,
  SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
  SUBSCRIPTION_LOGIN_UNCHECKED_MESSAGE,
  type ClassifiedRunError,
} from "./errors.ts";
import {
  materializeSubscriptionLoginForRun,
  pushSubscriptionLogin,
  readSubscriptionLoginForRun,
  writeSubscriptionLoginForRun,
  loginExpires,
  reportSubscriptionLoginFailure,
  type LocalSubscriptionFileDeps,
  type SubscriptionApiDeps,
  type SubscriptionPushState,
  type SubscriptionSandboxFs,
} from "./subscription-login.ts";
import type {
  ModelConnectionSubscription,
  SubscriptionLogin,
} from "../../protocol.ts";

type Log = (message: string) => void;

function defaultLog(message: string): void {
  process.stderr.write(`[sandbox_agent/subscription-recovery] ${message}\n`);
}

/**
 * `refreshOpenAICodexToken` from `@earendil-works/pi-ai/oauth`, typed structurally.
 *
 * It is the exact function Pi's own provider calls to renew a ChatGPT login, which is the point:
 * a judgement made with any other client would be a guess about what Pi would have seen.
 */
export type SubscriptionRefreshFn = (refreshToken: string) => Promise<{
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}>;

/** The lazy production binding. Dynamic for the same reason the device-login import is. */
export const defaultSubscriptionRefresh: SubscriptionRefreshFn = async (
  refreshToken,
) => {
  const { refreshOpenAICodexToken } = await import(
    "@earendil-works/pi-ai/oauth"
  );
  return refreshOpenAICodexToken(refreshToken);
};

/** What the provider said about this refresh token, reduced to what the runner can act on. */
export type RefreshVerdict =
  /** The provider issued a new pair. The login was never dead. */
  | { verdict: "success"; login: SubscriptionLogin }
  /** The provider refused the token. It will refuse it again. */
  | { verdict: "terminal"; reason: string }
  /** The provider could not answer. Nothing is known and nothing may be marked. */
  | { verdict: "retryable"; reason: string };

/**
 * The provider's refusal, read out of the message `refreshOpenAICodexToken` throws.
 *
 * pi-ai builds exactly two shapes and both are quoted here from
 * `dist/utils/oauth/openai-codex.js`:
 *
 *   `OpenAI Codex token refresh failed (<status>): <body>`   (readTokenResponse, HTTP not ok)
 *   `OpenAI Codex token refresh error: <cause>`              (refreshAccessToken, fetch threw)
 *
 * There is no error class and no status field to read, so the status comes out of the string. The
 * mapping:
 *
 * - 400, 401, 403: TERMINAL. The provider looked at this refresh token and refused it. The
 *   contract names `invalid_grant` and `refresh_token_*`, and those are the codes ChatGPT returns,
 *   but the status alone is already the provider's verdict on the credential — a 400 with an
 *   unrecognized code is still a refusal of THIS token, and treating it as transient would loop a
 *   dead login forever.
 * - 429 and every 5xx: RETRYABLE. The provider did not judge the token; it declined to answer.
 * - a fetch that threw: RETRYABLE. No answer at all.
 * - anything else, a 404 included: RETRYABLE. A route or client problem is not evidence about the
 *   credential, and the safe direction here is to mark nothing (A2).
 */
export function classifyRefreshError(err: unknown): "terminal" | "retryable" {
  const raw = err instanceof Error ? err.message : String(err);
  const status = /token refresh failed \((\d{3})\)/i.exec(raw)?.[1];
  if (status === "400" || status === "401" || status === "403") return "terminal";
  return "retryable";
}

/** A short word for WHY, for the log and the failure report. Never the provider's own sentence. */
export function refreshFailureReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/invalid_grant/i.test(raw)) return "invalid_grant";
  if (/refresh_token_/i.test(raw)) return "refresh_token_rejected";
  const status = /token refresh failed \((\d{3})\)/i.exec(raw)?.[1];
  if (status) return `refresh_status_${status}`;
  return "refresh_unreachable";
}

/**
 * Exchange this run's LOCAL refresh token with the provider and say what it answered.
 *
 * The local file is the input, never the delivered block: by the time a turn fails, Pi may have
 * rotated the token several times, and the delivered refresh token is then long spent. Asking the
 * provider about a token nobody holds any more would return "terminal" for a healthy connection.
 *
 * On success the new pair is written back through the same path that owns the file — under Pi's
 * lock locally, through the sandbox file API on Daytona — so the harness's next read finds it. The
 * other fields of the entry (`type`, `accountId`) are preserved: the provider returns only the
 * three token fields, and dropping the account id would break the API's own accountId check.
 */
export async function verifySubscriptionRefresh(input: {
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  refresh?: SubscriptionRefreshFn;
  log?: Log;
  fileDeps?: LocalSubscriptionFileDeps;
}): Promise<RefreshVerdict> {
  const log = input.log ?? defaultLog;
  let current: SubscriptionLogin | undefined;
  try {
    current = await readSubscriptionLoginForRun({
      home: input.home,
      isDaytona: input.isDaytona,
      ...(input.sandbox ? { sandbox: input.sandbox } : {}),
      ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
    });
  } catch (err) {
    log(
      `refresh check read failed error=${err instanceof Error ? err.name : "unknown"}`,
    );
    return { verdict: "retryable", reason: "login_unreadable" };
  }
  if (!current || typeof current.refresh !== "string" || !current.refresh) {
    // No token to exchange. The harness had nothing to authenticate with, which the API's own
    // record can act on, so this is terminal rather than unknown.
    return { verdict: "terminal", reason: "login_missing" };
  }

  const refresh = input.refresh ?? defaultSubscriptionRefresh;
  let pair: Awaited<ReturnType<SubscriptionRefreshFn>>;
  try {
    pair = await refresh(current.refresh);
  } catch (err) {
    const verdict = classifyRefreshError(err);
    const reason = refreshFailureReason(err);
    log(`refresh check verdict=${verdict} reason=${reason}`);
    return { verdict, reason };
  }
  if (loginExpires(pair) === undefined || typeof pair.refresh !== "string") {
    // A 200 whose body is not a usable pair. Nothing was refused, so nothing is known.
    return { verdict: "retryable", reason: "refresh_malformed" };
  }

  const login: SubscriptionLogin = { ...current, ...pair };
  try {
    await writeSubscriptionLoginForRun({
      home: input.home,
      isDaytona: input.isDaytona,
      ...(input.sandbox ? { sandbox: input.sandbox } : {}),
      login,
      ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
    });
  } catch (err) {
    // The pair is live but unreachable to the harness. Do not claim success: a retry would run
    // against the same file that just failed.
    log(
      `refresh check write failed error=${err instanceof Error ? err.name : "unknown"}`,
    );
    return { verdict: "retryable", reason: "login_unwritable" };
  }
  log("refresh check verdict=success");
  return { verdict: "success", login };
}

/** Retry this turn, or fail it with this copy. The whole output of the recovery decision. */
export type SubscriptionRecovery =
  | { action: "retry"; reason: string }
  | { action: "fail"; classified: ClassifiedRunError; reason: string };

/**
 * The events that make a turn unsafe to replay: anything the user has already seen, and anything
 * the harness already did to the world.
 *
 * Deliberately a positive list. A new event type is not replay-blocking until someone says it is,
 * and the two frames that are NOT here — the terminal `error` and the runner's own diagnostics —
 * are exactly the ones a failed turn emits on its way out.
 */
const REPLAY_BLOCKING_EVENTS = new Set([
  "message",
  "message_start",
  "message_delta",
  "message_end",
  "thought",
  "thought_start",
  "thought_delta",
  "thought_end",
  "tool_call",
  "tool_result",
  "interaction_request",
  "interaction_response",
  "data",
  "file",
]);

/** Whether one emitted event forbids replaying the turn it belongs to. */
export function isReplayBlockingEvent(type: string): boolean {
  return REPLAY_BLOCKING_EVENTS.has(type);
}

/**
 * Decide what a subscription run does about an authentication failure. Undefined when the failure
 * is not about the login, which leaves the generic classifier's answer in place.
 *
 * `replayable` is the caller's judgement, not this module's: only the turn knows whether it has
 * emitted anything yet, and only the turn knows whether it has already used its one retry.
 */
export async function recoverSubscriptionAuthFailure(input: {
  err: unknown;
  subscription: ModelConnectionSubscription;
  state: SubscriptionPushState;
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  api: SubscriptionApiDeps;
  /** False when the turn already emitted output, or already spent its one retry. */
  replayable: boolean;
  refresh?: SubscriptionRefreshFn;
  log?: Log;
  fileDeps?: LocalSubscriptionFileDeps;
}): Promise<SubscriptionRecovery | undefined> {
  if (!isSubscriptionAuthFailure(input.err)) return undefined;
  const log = input.log ?? input.api.log ?? defaultLog;
  const fail = (
    classified: ClassifiedRunError,
    reason: string,
  ): SubscriptionRecovery => {
    log(`recovery action=fail code=${classified.code} reason=${reason}`);
    return { action: "fail", classified, reason };
  };
  const retryOrFail = (reason: string): SubscriptionRecovery => {
    if (input.replayable) {
      log(`recovery action=retry reason=${reason}`);
      return { action: "retry", reason };
    }
    // A1.3: the turn is not replayed, but the login IS fixed, so the next message succeeds.
    return fail(
      {
        message: SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
        code: "subscription_login_refreshed",
      },
      `${reason}-not-replayable`,
    );
  };

  // A2, step one: ask the provider before anything is recorded anywhere.
  const verdict = await verifySubscriptionRefresh({
    home: input.home,
    isDaytona: input.isDaytona,
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
    ...(input.refresh ? { refresh: input.refresh } : {}),
    log,
    ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
  });

  if (verdict.verdict === "success") {
    // The connection is fine and the runner now holds a live pair nobody else has. Publish it
    // before retrying: if the retry dies, the next run must still find this token.
    await pushSubscriptionLogin(
      input.subscription,
      input.state,
      verdict.login,
      input.api,
    );
    return retryOrFail("refresh-succeeded");
  }

  if (verdict.verdict === "retryable") {
    // Mark NOTHING. A transient provider outage must not put a healthy connection into
    // `needs_login`, and the user's own retry is the cheapest next step.
    return fail(
      {
        message: SUBSCRIPTION_LOGIN_UNCHECKED_MESSAGE,
        code: "subscription_login_refreshed",
      },
      verdict.reason,
    );
  }

  // A1, step one: terminal for THIS login, but the connection may already hold a newer one.
  const report = await reportSubscriptionLoginFailure(
    input.subscription,
    input.state,
    // The harness's own words when they are specific, the provider's refusal otherwise.
    subscriptionAuthFailureReason(input.err) === "unauthorized"
      ? verdict.reason
      : subscriptionAuthFailureReason(input.err),
    input.api,
  );
  if (!report.stale) {
    return fail(subscriptionAuthError(false), verdict.reason);
  }
  if (!report.login) {
    // The API says this run is behind but gave nothing to run on. Retryable, not a re-login.
    return fail(subscriptionAuthError(true), "stale-without-login");
  }

  const generation = report.generation ?? input.state.generation;
  const version = report.version ?? input.state.version;
  const decision = await materializeSubscriptionLoginForRun({
    home: input.home,
    isDaytona: input.isDaytona,
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
    subscription: { login: report.login, version, generation },
    log,
    ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
  });
  if (!decision.write) {
    // The file already held something the A4 ordering prefers. Nothing changed, so a retry would
    // run against the same credential that just failed.
    return fail(subscriptionAuthError(true), `stale-${decision.reason}`);
  }
  // The session now runs on the recovered login. Move the floor so the push-back does not send it
  // straight back to the API that just handed it over.
  input.state.generation = generation;
  input.state.version = version;
  input.state.deliveredExpires = loginExpires(report.login);
  input.state.pushedExpires = loginExpires(report.login);

  if (generation !== input.subscription.generation) {
    // A NEW SIGN-IN, not a refresh. The running harness cached a token of the dead lineage and Pi
    // does not re-read `auth.json` while its cached token is unexpired, so this daemon can never
    // use the recovered login however many times the turn is replayed. The contract asks for a
    // daemon restart here; the turn seam cannot restart one, so the turn fails RETRYABLY instead.
    // A failed turn is never parked (`shouldPark`), the session fingerprint hashes `generation`,
    // and the file on disk now holds the new login — so the next message cold-starts on it. See
    // the deviation note in the runner track's report.
    return fail(subscriptionAuthError(true), "stale-new-generation");
  }
  return retryOrFail("stale-recovered");
}
