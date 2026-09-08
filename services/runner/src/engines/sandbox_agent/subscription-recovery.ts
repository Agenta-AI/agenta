/**
 * What the runner does when a hosted subscription run says its login was refused.
 *
 * Nothing here streams, tears down, or retries. It answers ONE question, "retry or fail, and with
 * which copy", and leaves the acting to the turn path.
 *
 * THE ORDER MATTERS, AND IT IS NOT THE OBVIOUS ONE.
 *
 * 1. ASK THE PROVIDER FIRST, NOT THE API. Pi reports the same sentence for a dead login and for a
 *    refresh that lost a race, timed out, or hit a 500. Reporting the first as the second marks a
 *    healthy connection `needs_login` and sends the user through a sign-in they did not need. So
 *    the runner exchanges the LOCAL refresh token itself, through the same client function Pi uses:
 *      - the exchange SUCCEEDS -> the login was never dead. Keep the new pair, publish it, retry.
 *      - the provider REFUSES it (400, 401, 403) -> terminal.
 *      - the call cannot complete (network, 5xx, 429) -> nothing is known. Mark NOTHING.
 * 2. ONLY THEN ASK THE API. A terminal refusal still has one innocent explanation: another session
 *    signed in again and this run holds the previous login. Only the API knows what it stores, and
 *    a `stale` answer carries the current login to rematerialize and retry on.
 * 3. RETRY ONLY WHAT IS SAFE TO REPLAY. A turn that already streamed text or ran a tool has side
 *    effects the user has seen. It fails retryably instead, and the next message picks up the
 *    recovered login.
 *
 * NOTHING HERE LOGS A CREDENTIAL. Not the token, not the refresh token, and not the provider's
 * error body, which is the request echoed back and carries the refresh token.
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
  loginExpires,
  materializeSubscriptionLoginForRun,
  mutateSubscriptionLogin,
  type LocalSubscriptionFileDeps,
  type SubscriptionSandboxFs,
} from "./subscription-login/files.ts";
import {
  adoptSubscriptionLogin,
  reportSubscriptionLoginFailure,
  type PublishTrigger,
  type SubscriptionApiDeps,
  type SubscriptionPublishState,
} from "./subscription-login/publisher.ts";
import { observeSubscription } from "../../subscription-events.ts";
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
 * It is the exact function Pi's own provider calls to renew a ChatGPT login, which is the point: a
 * judgement made with any other client would be a guess about what Pi would have seen.
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
 * pi-ai builds exactly two shapes, both quoted here from `dist/utils/oauth/openai-codex.js`:
 *
 *   `OpenAI Codex token refresh failed (<status>): <body>`   (readTokenResponse, HTTP not ok)
 *   `OpenAI Codex token refresh error: <cause>`              (refreshAccessToken, fetch threw)
 *
 * There is no error class and no status field to read, so the status comes out of the string.
 *
 * - 400, 401, 403: TERMINAL. The provider looked at this refresh token and refused it. A 400 with
 *   an unrecognized code is still a refusal of THIS token, and treating it as transient would loop
 *   a dead login forever.
 * - 429 and every 5xx: RETRYABLE. The provider did not judge the token; it declined to answer.
 * - a fetch that threw, and anything else including a 404: RETRYABLE. A route or client problem is
 *   not evidence about the credential, and the safe direction is to mark nothing.
 */
export function classifyRefreshError(err: unknown): "terminal" | "retryable" {
  const raw = err instanceof Error ? err.message : String(err);
  const status = /token refresh failed \((\d{3})\)/i.exec(raw)?.[1];
  if (status === "400" || status === "401" || status === "403") return "terminal";
  return "retryable";
}

/**
 * The provider's codes for "this refresh token is finished", as an EXPLICIT LIST.
 *
 * The two measured on the real endpoint on 2026-09-08 sit either side of a prefix rule, which is
 * why this is a list rather than a pattern. A rotated-away token first answers 401 with
 * `refresh_token_reused`, and from about two hours on it answers 401 with `invalid_refresh_token`.
 *
 * It is deliberately NOT the looser `/refresh_token/`. The provider echoes the request in its error
 * body, and that body carries the `refresh_token` PARAMETER NAME on every failure; matching it
 * would label every refresh error a token refusal, including the network and 5xx cases.
 *
 * This only chooses the word stored as `login_error`. Whether the failure is terminal comes from
 * the HTTP status alone.
 */
const REFRESH_TOKEN_REFUSAL_CODE =
  /refresh_token_(?:reused|expired|invalidated|revoked)|invalid_refresh_token/i;

/** A short word for WHY, for the log and the failure report. Never the provider's own sentence. */
export function refreshFailureReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/invalid_grant/i.test(raw)) return "invalid_grant";
  if (REFRESH_TOKEN_REFUSAL_CODE.test(raw)) return "refresh_token_rejected";
  const status = /token refresh failed \((\d{3})\)/i.exec(raw)?.[1];
  if (status) return `refresh_status_${status}`;
  return "refresh_unreachable";
}

/**
 * Exchange this run's LOCAL refresh token with the provider and say what it answered.
 *
 * The local file is the input, never the delivered block: by the time a turn fails, Pi may have
 * rotated the token several times, so asking about a token nobody holds would return "terminal" for
 * a healthy connection.
 *
 * THE READ, THE EXCHANGE, AND THE WRITE ARE ONE LOCKED OPERATION. Split, another session can
 * install a newer login while the provider is answering, and this one then overwrites it with a
 * lineage the sidecar no longer describes. The `generation` guard is the second half of that: a
 * writer never overwrites a file that has moved to a newer sign-in.
 *
 * On success the new pair is written where the harness reads it. The entry's other fields (`type`,
 * `accountId`) are preserved: the provider returns only the three token fields, and dropping the
 * account id would break the API's own accountId check.
 */
export async function verifySubscriptionRefresh(input: {
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  /** The lineage this run belongs to. A file on a newer one is never overwritten. */
  generation: number;
  refresh?: SubscriptionRefreshFn;
  log?: Log;
  fileDeps?: LocalSubscriptionFileDeps;
}): Promise<RefreshVerdict> {
  const log = input.log ?? defaultLog;
  const refresh = input.refresh ?? defaultSubscriptionRefresh;
  let outcome: { result: RefreshVerdict; wrote: boolean };
  try {
    outcome = await mutateSubscriptionLogin<RefreshVerdict>({
      home: input.home,
      isDaytona: input.isDaytona,
      ...(input.sandbox ? { sandbox: input.sandbox } : {}),
      ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
      mutate: async (current, meta) => {
        if (!current || typeof current.refresh !== "string" || !current.refresh) {
          // No token to exchange. The harness had nothing to authenticate with, which the API's
          // own record can act on, so this is terminal rather than unknown.
          return { result: { verdict: "terminal", reason: "login_missing" } };
        }
        if (meta && meta.generation > input.generation) {
          // The file already belongs to a newer sign-in. BEFORE the exchange, because exchanging
          // that lineage's refresh token would spend it for a run that may not write the result
          // back, leaving the sessions on the new lineage with a token the provider has rotated.
          return { result: { verdict: "retryable", reason: "generation_moved" } };
        }
        let pair: Awaited<ReturnType<SubscriptionRefreshFn>>;
        try {
          pair = await refresh(current.refresh);
        } catch (err) {
          return {
            result: {
              verdict: classifyRefreshError(err),
              reason: refreshFailureReason(err),
            },
          };
        }
        if (loginExpires(pair) === undefined || typeof pair.refresh !== "string") {
          // A 200 whose body is not a usable pair. Nothing was refused, so nothing is known.
          return { result: { verdict: "retryable", reason: "refresh_malformed" } };
        }
        const login: SubscriptionLogin = { ...current, ...pair };
        return { result: { verdict: "success", login }, login };
      },
    });
  } catch (err) {
    observeSubscription(log, "subscription.recovery", {
      decision: "refresh-check",
      verdict: "retryable",
      reason: "login_unusable",
      error: err instanceof Error ? err.name : "unknown",
    });
    return { verdict: "retryable", reason: "login_unusable" };
  }
  const verdict =
    outcome.result.verdict === "success" && !outcome.wrote
      ? // The pair is live but the harness cannot reach it. Claiming success would retry against
        // the same file that just failed.
        ({ verdict: "retryable", reason: "login_unwritable" } as const)
      : outcome.result;
  observeSubscription(log, "subscription.recovery", {
    decision: "refresh-check",
    verdict: verdict.verdict,
    reason: verdict.verdict === "success" ? undefined : verdict.reason,
  });
  return verdict;
}

/**
 * Fail this turn with this copy. The whole output of the recovery decision.
 *
 * There is no "retry" outcome. A recovery repairs the login FILE, and the harness that is already
 * running cannot read it: Pi caches its credential when the daemon starts and re-reads `auth.json`
 * only once the cached one has expired (pinned 0.80.6 `AuthStorage.getApiKey`), which is never the
 * case here — the provider refused a token whose expiry is still in the future. Pi's rpc mode
 * exposes no reload method and pi-acp forwards none, so nothing can make that daemon change its
 * mind inside the turn. Every repaired login therefore fails the turn RETRYABLY and is picked up
 * by the cold start the next message makes.
 */
export type SubscriptionRecovery = {
  action: "fail";
  classified: ClassifiedRunError;
  reason: string;
};

/**
 * Decide what a subscription run does about an authentication failure. Undefined when the failure
 * is not about the login, which leaves the generic classifier's answer in place.
 */
export async function recoverSubscriptionAuthFailure(input: {
  err: unknown;
  subscription: ModelConnectionSubscription;
  state: SubscriptionPublishState;
  home: string;
  isDaytona: boolean;
  sandbox?: SubscriptionSandboxFs;
  api: SubscriptionApiDeps;
  /** The session publisher, so a recovered login is published by the one operation that publishes. */
  publish?: (trigger: PublishTrigger) => Promise<void>;
  refresh?: SubscriptionRefreshFn;
  log?: Log;
  fileDeps?: LocalSubscriptionFileDeps;
}): Promise<SubscriptionRecovery | undefined> {
  if (!isSubscriptionAuthFailure(input.err)) return undefined;
  const log = input.log ?? input.api.log ?? defaultLog;
  const decided = (
    recovery: SubscriptionRecovery,
    verdict: string,
  ): SubscriptionRecovery => {
    observeSubscription(log, "subscription.recovery", {
      connection: input.subscription.id,
      decision: "recover",
      verdict,
      action: recovery.action,
      reason: recovery.reason,
      code: recovery.classified.code,
    });
    return recovery;
  };
  const fail = (
    classified: ClassifiedRunError,
    reason: string,
    verdict: string,
  ): SubscriptionRecovery =>
    decided({ action: "fail", classified, reason }, verdict);
  /**
   * The login is repaired on disk, and this turn still cannot use it (see
   * {@link SubscriptionRecovery}). Fail retryably so the next message cold-starts on it.
   */
  const coldStart = (reason: string, verdict: string): SubscriptionRecovery =>
    fail(subscriptionAuthError(true), reason, verdict);

  // Step one: ask the provider before anything is recorded anywhere.
  const verdict = await verifySubscriptionRefresh({
    home: input.home,
    isDaytona: input.isDaytona,
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
    generation: input.state.generation,
    ...(input.refresh ? { refresh: input.refresh } : {}),
    log,
    ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
  });

  if (verdict.verdict === "success") {
    // The connection is fine and the runner now holds a live pair nobody else has. Publish it
    // before retrying: if the retry dies, the next run must still find this token.
    await input.publish?.("recovery");
    return coldStart("refresh-succeeded", verdict.verdict);
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
      verdict.verdict,
    );
  }

  // Terminal for THIS login, but the connection may already hold a newer one.
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
    return fail(subscriptionAuthError(false), verdict.reason, verdict.verdict);
  }
  if (!report.login) {
    // The API says this run is behind but gave nothing to run on. Retryable, not a re-login.
    return fail(subscriptionAuthError(true), "stale-without-login", verdict.verdict);
  }

  const generation = report.generation ?? input.state.generation;
  const version = report.version ?? input.state.version;
  const decision = await materializeSubscriptionLoginForRun({
    home: input.home,
    isDaytona: input.isDaytona,
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
    subscription: {
      id: input.subscription.id,
      login: report.login,
      version,
      generation,
    },
    log,
    ...(input.fileDeps ? { fileDeps: input.fileDeps } : {}),
  });
  if (!decision.write) {
    // The file already held something the ordering prefers. Nothing changed, so a retry would run
    // against the same credential that just failed.
    return fail(
      subscriptionAuthError(true),
      `stale-${decision.reason}`,
      verdict.verdict,
    );
  }
  // The session now runs on the recovered login, and the API plainly holds it, so the publisher has
  // nothing to send. This is the one event that changes what this run runs on, so a later failure
  // report asks about the recovered login rather than the dead one it started with.
  adoptSubscriptionLogin(input.state, generation, version, report.login);

  // A new sign-in also changes the session fingerprint, which hashes `generation`, so the two
  // reasons are told apart in the log even though both end the turn the same way.
  return coldStart(
    generation !== input.subscription.generation
      ? "stale-new-generation"
      : "stale-recovered",
    verdict.verdict,
  );
}
