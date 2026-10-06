/**
 * Device-code login attempts for a hosted subscription connection.
 *
 * ACP cannot carry a login and Pi has no `login` subcommand, so the OAuth exchange happens HERE,
 * in the runner, through the same client code Pi's own `/login openai-codex` runs
 * (`loginOpenAICodexDeviceCode` from `@earendil-works/pi-ai/oauth`). The API relays the user code
 * and the verification address to the browser. Nothing here writes to disk.
 *
 * ONE ATTEMPT IS ONE RUNNING PROMISE. The device-code flow is a long poll against
 * `auth.openai.com` that Pi drives itself; there is no step-by-step API to advance. So an attempt
 * is that promise plus an `AbortController`, held in a process map only so a DELETE can stop it.
 *
 * THE OUTCOME GOES TO THE API, NOT BACK THROUGH A READ. Runner pods behind one Service URL are
 * interchangeable, so a later request about this attempt can land on a pod that never held it.
 * The pod whose loop ends reports the outcome (the login, a failure, an expiry) to the API itself,
 * and the API answers the browser from the record it keeps on the connection. The login lives in
 * this process only between the provider's answer and that report.
 *
 * NOTHING HERE IS LOGGED. Not the login, not the user code (it authorizes an account takeover for
 * the length of the flow), not the verification address with its code embedded. The log lines
 * carry an attempt id, a state word, an HTTP status, and nothing else.
 */
import { randomUUID } from "node:crypto";

import { apiBase } from "./apiBase.ts";
import { withinBudget } from "./lifecycle/shutdown.ts";
import { observeSubscription } from "./subscription-events.ts";
import type { SubscriptionLogin } from "./protocol.ts";

type Log = (message: string) => void;

/** The only provider this runner can log in to today. The API sends it explicitly all the same. */
export const SUBSCRIPTION_LOGIN_PROVIDER = "chatgpt";

/** The floor the API's `poll_after_ms` is derived from when the provider names no interval. */
export const DEFAULT_POLL_INTERVAL_SECONDS = 5;

/** The bound on one outcome report to the API. */
export const OUTCOME_REPORT_TIMEOUT_MS = 5_000;

/**
 * The waits between outcome report tries. A login the API never hears about is lost, and the
 * user's poll ends as expired at the provider's deadline, so a short API outage is worth riding
 * out; a long one is not worth holding a credential in memory for.
 *
 * Four tries of `OUTCOME_REPORT_TIMEOUT_MS` plus these waits is at most 27 s. The API waits 30 s
 * past the provider's deadline before it calls a silent attempt expired
 * (`_DEADLINE_GRACE` in `api/oss/src/core/secrets/subscription_service.py`), so a success at the
 * deadline still lands. Keep the sum below that grace.
 */
export const OUTCOME_REPORT_RETRY_DELAYS_MS: readonly number[] = [
  1_000, 2_000, 4_000,
];

/** How an attempt ended, in the words the API stores. A cancelled attempt reports nothing. */
export type AttemptOutcomeState =
  /** The provider returned a login. */
  | "succeeded"
  /** The flow failed. `error` says why, in words that carry no account detail. */
  | "failed"
  /** The provider's own 15 minute device-code window ran out. */
  | "expired";

/** The connection an attempt signs in, as the API names it. Not a secret. */
export interface AttemptOwner {
  projectId: string;
  secretId: string;
}

/** One outcome report. `login` rides only a `succeeded` outcome. */
export interface AttemptOutcome extends AttemptOwner {
  attemptId: string;
  state: AttemptOutcomeState;
  login?: SubscriptionLogin;
  error?: string;
}

/**
 * Delivers an outcome to the API. Never throws. `retry: false` makes one try only, for a process
 * that is about to exit.
 */
export type ReportAttemptOutcome = (
  outcome: AttemptOutcome,
  options?: { retry?: boolean },
) => Promise<void>;

/**
 * The reason an attempt carries when this process stops before its provider poll ends. It is the
 * text the API answered when an attempt was lost before outcomes were reported, so the browser
 * keeps its sentence for it ("start it again").
 */
export const ABANDONED_ATTEMPT_REASON = "attempt not found; try again";

/** The bound on reporting every live attempt as abandoned at shutdown. */
export const ABANDON_REPORT_BUDGET_MS = 3_000;

/** What the device-code callback reported, before the user approved anything. */
export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}

/** The shape `loginOpenAICodexDeviceCode` satisfies. Injected so tests need no provider. */
export type DeviceCodeLogin = (options: {
  onDeviceCode: (info: DeviceCodeInfo) => void;
  signal?: AbortSignal;
}) => Promise<{ access: string; refresh: string; expires: number; [key: string]: unknown }>;

interface Attempt {
  id: string;
  owner: AttemptOwner;
  abort: AbortController;
}

/** A started attempt as the start route answers it. Always pending: the user has seen nothing yet. */
export interface AttemptView {
  attemptId: string;
  state: "pending";
  userCode?: string;
  verificationUri?: string;
  expiresAt?: string;
  intervalSeconds?: number;
}

function defaultLog(message: string): void {
  process.stderr.write(`[subscription-login] ${message}\n`);
}

/**
 * The provider's message, reduced to a short word for the browser.
 *
 * A raw provider error can quote the request, and a request on this path carries the device code.
 * The API surfaces this string to a user who can act on exactly two things: retry, or wait.
 */
function safeErrorReason(err: unknown): string {
  if (err instanceof Error && /timed out|timeout/i.test(err.message)) {
    return "timed_out";
  }
  return "login_failed";
}

export interface OutcomeReportDeps {
  fetchImpl?: typeof fetch;
  apiBase?: string;
  token?: string;
  retryDelaysMs?: readonly number[];
  log?: Log;
}

/**
 * POST one outcome to the API, retrying a few times on a transport failure, a 5xx, a 404, a 408
 * or a 429.
 *
 * Authenticates with the shared runner token, not a project credential: a device login runs on
 * behalf of a browser, and the runner holds no credential of that project. The ids in the body
 * tell the API which connection to update, and the API applies the outcome only while that
 * connection still waits on this attempt id.
 *
 * A 404 is retried because it can come too early, not only too late. The API stores the attempt
 * on the connection only after the start answer comes back from this runner, so a flow that fails
 * just after the provider issues the code can report before that record exists. A retry cannot
 * land on another attempt: each attempt id is a fresh UUID minted here, and the API applies a
 * report only to the record with that id. A 404 for an attempt the user cancelled or replaced is
 * retried to no effect and then dropped. A 404 on every try logs as `refused`: the API answered
 * each time, so it is not an outage.
 *
 * Any other answer ends the report: repeating the same body cannot change an API decision.
 */
export async function reportAttemptOutcome(
  outcome: AttemptOutcome,
  deps: OutcomeReportDeps = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const event = { attempt: outcome.attemptId, state: outcome.state };
  const token = deps.token ?? process.env.AGENTA_RUNNER_TOKEN;
  if (!token) {
    observeSubscription(log, "subscription.attempt", {
      ...event,
      report: "unconfigured",
    });
    return;
  }
  const doFetch = deps.fetchImpl ?? fetch;
  const delays = deps.retryDelaysMs ?? OUTCOME_REPORT_RETRY_DELAYS_MS;
  const url = `${deps.apiBase ?? apiBase()}/secrets/subscription-login/attempts/${encodeURIComponent(outcome.attemptId)}/outcome`;
  const body = JSON.stringify({
    project_id: outcome.projectId,
    secret_id: outcome.secretId,
    state: outcome.state,
    ...(outcome.login ? { login: outcome.login } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  });

  for (let attempt = 0; ; attempt += 1) {
    let status: number | undefined;
    let retryable = true;
    let notFound = false;
    try {
      const res = await doFetch(url, {
        method: "POST",
        // A redirect would carry the token and the login to wherever it points.
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "x-agenta-runner-token": token,
        },
        body,
        signal: AbortSignal.timeout(OUTCOME_REPORT_TIMEOUT_MS),
      });
      status = res.status;
      if (res.ok) {
        observeSubscription(log, "subscription.attempt", {
          ...event,
          report: "delivered",
          status,
        });
        return;
      }
      notFound = status === 404;
      retryable = notFound || status >= 500 || status === 408 || status === 429;
    } catch {
      // A transport failure or the timeout. The error text is not recorded: it can quote the
      // request.
    }
    if (!retryable || attempt >= delays.length) {
      observeSubscription(log, "subscription.attempt", {
        ...event,
        report: retryable && !notFound ? "unanswered" : "refused",
        status,
        tries: attempt + 1,
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
  }
}

/**
 * The attempt store. One per process. The login and report functions are constructor arguments
 * rather than module globals, so a test builds its own store with neither a provider nor an API.
 */
export class SubscriptionLoginAttempts {
  private readonly attempts = new Map<string, Attempt>();
  /**
   * Outcome reports still on their way to the API. A finished attempt has already left the map,
   * so this is the only way shutdown can find, and wait for, a login it is still delivering.
   */
  private readonly reporting = new Set<Promise<void>>();

  constructor(
    private readonly login: DeviceCodeLogin,
    private readonly report: ReportAttemptOutcome,
    private readonly log: Log = defaultLog,
  ) {}

  /**
   * Start a device login for `owner`. Resolves as soon as the provider has issued a user code, so
   * the caller can render it; the approval poll keeps running in the background and reports its
   * outcome to the API when it ends.
   *
   * A start that never reaches the device-code callback (the provider refused the request) fails
   * here rather than leaving a pending attempt nobody can act on, and reports nothing.
   */
  async start(provider: string, owner: AttemptOwner): Promise<AttemptView> {
    const id = randomUUID();
    const abort = new AbortController();
    const attempt: Attempt = { id, owner, abort };
    this.attempts.set(id, attempt);

    let codeIssued = false;
    let announced: ((view: AttemptView) => void) | undefined;
    let announceFailed: ((err: unknown) => void) | undefined;
    const deviceCode = new Promise<AttemptView>((resolve, reject) => {
      announced = resolve;
      announceFailed = reject;
    });

    const flow = this.login({
      signal: abort.signal,
      onDeviceCode: (info) => {
        codeIssued = true;
        announced?.(startView(id, info));
      },
    });

    // The flow's outcome is reported whenever it settles, which is usually long after this
    // method has returned. `void` is deliberate: the caller waits for the device code, not for
    // the user. `finish` never rejects, so nothing here can become an unhandled rejection.
    void flow.then(
      (credentials) =>
        // `type` is what Pi's own AuthStorage stamps on an OAuth credential before writing it,
        // and the vault stores the file-ready shape, so it is added here rather than three
        // layers on.
        this.finish(attempt, {
          state: "succeeded",
          login: { type: "oauth", ...credentials } as SubscriptionLogin,
        }),
      (err: unknown) => {
        // A cancel already forgot the attempt, and the API already cleared its record.
        if (abort.signal.aborted) return;
        if (!codeIssued) {
          announceFailed?.(err);
          return;
        }
        const reason = safeErrorReason(err);
        return this.finish(attempt, {
          state: reason === "timed_out" ? "expired" : "failed",
          error: reason,
        });
      },
    );

    let view: AttemptView;
    try {
      view = await deviceCode;
    } catch (err) {
      this.attempts.delete(id);
      throw new Error(
        `subscription login could not start: ${safeErrorReason(err)}`,
      );
    }
    observeSubscription(this.log, "subscription.attempt", {
      attempt: id,
      state: "pending",
      provider,
    });
    return view;
  }

  /**
   * Stop an attempt and forget it. Idempotent: an unknown id is a no-op, like a repeated DELETE,
   * and so is an id another pod holds.
   *
   * The API sends this when the user cancels, after it has already cleared the attempt's record,
   * so the loop it stops reports nothing.
   */
  cancel(id: string): void {
    const attempt = this.attempts.get(id);
    if (!attempt) return;
    attempt.abort.abort();
    this.attempts.delete(id);
    observeSubscription(this.log, "subscription.attempt", {
      attempt: id,
      state: "cancelled",
    });
  }

  /**
   * Give up every live attempt because this process is stopping, and tell the API so.
   *
   * Without this the user's poll would answer pending until the provider's window closed, while
   * the provider itself may already say "signed in". Each attempt leaves the map and its flow is
   * aborted first, so the flow reports nothing of its own; then each gets one report try. The
   * outcome reports of attempts that already finished are waited for too, so a login the user just
   * approved still reaches the API. All of it is bounded together by `budgetMs`: past it the wait
   * ends, the process exits, and a report the API has not answered is lost, so the poll falls back
   * to the deadline.
   */
  async abandonAll(budgetMs: number = ABANDON_REPORT_BUDGET_MS): Promise<void> {
    const live = [...this.attempts.values()];
    const inFlight = [...this.reporting];
    if (live.length === 0 && inFlight.length === 0) return;
    this.attempts.clear();
    for (const attempt of live) {
      attempt.abort.abort();
      observeSubscription(this.log, "subscription.attempt", {
        attempt: attempt.id,
        state: "failed",
        abandoned: true,
      });
    }
    await withinBudget(
      Promise.allSettled([
        ...inFlight,
        ...live.map((attempt) =>
          this.report(
            {
              attemptId: attempt.id,
              projectId: attempt.owner.projectId,
              secretId: attempt.owner.secretId,
              state: "failed",
              error: ABANDONED_ATTEMPT_REASON,
            },
            { retry: false },
          ),
        ),
      ]),
      budgetMs,
    );
  }

  /** Test seam: how many attempts the map still holds. */
  size(): number {
    return this.attempts.size;
  }

  /**
   * Report how the attempt ended, then let the login go out of scope with the report.
   *
   * The attempt leaves the map first, so a DELETE that races the report is a no-op here; the API
   * then finds no record for the late report and drops it.
   */
  private async finish(
    attempt: Attempt,
    result: { state: AttemptOutcomeState; login?: SubscriptionLogin; error?: string },
  ): Promise<void> {
    // A cancel already removed the attempt; the flow settling afterwards must not report it.
    if (!this.attempts.has(attempt.id)) return;
    this.attempts.delete(attempt.id);
    observeSubscription(this.log, "subscription.attempt", {
      attempt: attempt.id,
      state: result.state,
    });
    const delivery = (async () => {
      try {
        await this.report({
          attemptId: attempt.id,
          projectId: attempt.owner.projectId,
          secretId: attempt.owner.secretId,
          ...result,
        });
      } catch {
        // The reporter does not throw. This guard keeps a broken one from crashing the process.
      }
    })();
    this.reporting.add(delivery);
    await delivery;
    this.reporting.delete(delivery);
  }
}

/**
 * The start answer, built when the provider issues the code. The attempt keeps no copy of it:
 * nothing after the start reads the user code.
 */
function startView(attemptId: string, info: DeviceCodeInfo): AttemptView {
  const view: AttemptView = { attemptId, state: "pending" };
  if (info.userCode) view.userCode = info.userCode;
  if (info.verificationUri) view.verificationUri = info.verificationUri;
  if (info.expiresInSeconds) {
    view.expiresAt = new Date(Date.now() + info.expiresInSeconds * 1000).toISOString();
  }
  const intervalSeconds = info.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
  if (intervalSeconds) view.intervalSeconds = intervalSeconds;
  return view;
}

let shared: SubscriptionLoginAttempts | undefined;

/**
 * The process-wide store, built on the first request that needs it.
 *
 * The pi-ai import is DYNAMIC and lazy on purpose: the oauth entry point pulls the provider stack
 * with it, and a runner that never serves a login request should not pay for that at boot.
 */
export function subscriptionLoginAttempts(): SubscriptionLoginAttempts {
  if (!shared) {
    const login: DeviceCodeLogin = async (options) => {
      const { loginOpenAICodexDeviceCode } = await import(
        "@earendil-works/pi-ai/oauth"
      );
      return loginOpenAICodexDeviceCode(options);
    };
    shared = new SubscriptionLoginAttempts(login, (outcome, options) =>
      reportAttemptOutcome(
        outcome,
        options?.retry === false ? { retryDelaysMs: [] } : {},
      ),
    );
  }
  return shared;
}

/**
 * The shutdown step for device logins: abandon every live attempt of the process-wide store, and
 * wait (bounded) for the outcome reports still on their way. A process that never served a login
 * has no store, and builds none here.
 */
export async function abandonSubscriptionLogins(): Promise<void> {
  await shared?.abandonAll();
}

/** Test seam: install a store with an injected login function. */
export function setSubscriptionLoginAttempts(
  store: SubscriptionLoginAttempts | undefined,
): void {
  shared = store;
}
