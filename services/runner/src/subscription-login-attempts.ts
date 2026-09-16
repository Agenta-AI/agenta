/**
 * Device-code login attempts for a hosted subscription connection.
 *
 * ACP cannot carry a login and Pi has no `login` subcommand, so the OAuth exchange happens HERE,
 * in the runner, through the same client code Pi's own `/login openai-codex` runs
 * (`loginOpenAICodexDeviceCode` from `@earendil-works/pi-ai/oauth`). The API relays the user code
 * and the verification address to the browser, polls this runner, and stores the login when it
 * lands. Nothing here writes to disk.
 *
 * ONE ATTEMPT IS ONE RUNNING PROMISE. The device-code flow is a long poll against
 * `auth.openai.com` that Pi drives itself; there is no step-by-step API to advance. So an attempt
 * is that promise plus an `AbortController`, held in a process map, and the HTTP routes only read
 * its settled state. That is also why an attempt cannot survive a runner restart, and why the API
 * treats a missing attempt as expired rather than as an error.
 *
 * THE LOGIN IS HANDED OUT UNTIL THE API SAYS IT IS SAFE TO STOP. Every GET on a `succeeded`
 * attempt returns it, and only the DELETE that follows the API's own durable write drops it. A GET
 * is a token-authenticated call from the API, so re-reading it discloses nothing new; the DELETE
 * and the purge timer below are what bound the credential's residency in this process.
 *
 * NOTHING HERE IS LOGGED. Not the login, not the user code (it authorizes an account takeover for
 * the length of the flow), not the verification address with its code embedded. The log lines
 * carry an attempt id, a state word, and nothing else.
 */
import { randomUUID } from "node:crypto";

import { observeSubscription } from "./subscription-events.ts";
import type { SubscriptionLogin } from "./protocol.ts";

type Log = (message: string) => void;

/** The only provider this runner can log in to today. The API sends it explicitly all the same. */
export const SUBSCRIPTION_LOGIN_PROVIDER = "chatgpt";

/** How long a finished or abandoned attempt stays in the map before it is dropped. */
export const ATTEMPT_PURGE_MS = 20 * 60 * 1000;

/** The floor the API's `poll_after_ms` is derived from when the provider names no interval. */
export const DEFAULT_POLL_INTERVAL_SECONDS = 5;

export type AttemptState =
  /** The device code is out and the flow is waiting for the user to approve it. */
  | "pending"
  /** The provider returned a login. Every read returns it until the API deletes the attempt. */
  | "succeeded"
  /** The flow failed. `error` says why, in words that carry no account detail. */
  | "failed"
  /** The provider's own 15 minute device-code window ran out. */
  | "expired"
  /** A DELETE ended it, or the runner is shutting down. */
  | "cancelled";

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
  provider: string;
  state: AttemptState;
  createdAt: number;
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresAt?: number;
  error?: string;
  login?: SubscriptionLogin;
  abort: AbortController;
  purgeTimer?: ReturnType<typeof setTimeout>;
}

/** One attempt as a route answers it. `login` appears while the attempt is succeeded. */
export interface AttemptView {
  attemptId: string;
  state: AttemptState;
  userCode?: string;
  verificationUri?: string;
  expiresAt?: string;
  intervalSeconds?: number;
  login?: SubscriptionLogin;
  error?: string;
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

/**
 * The attempt store. One per process; `createSubscriptionLoginAttempts` exists so a test gets its
 * own, and so the injected login function is a constructor argument rather than a module global.
 */
export class SubscriptionLoginAttempts {
  private readonly attempts = new Map<string, Attempt>();

  constructor(
    private readonly login: DeviceCodeLogin,
    private readonly log: Log = defaultLog,
    private readonly purgeMs: number = ATTEMPT_PURGE_MS,
  ) {}

  /**
   * Start a device login. Resolves as soon as the provider has issued a user code, so the caller
   * can render it; the approval poll keeps running in the background.
   *
   * A start that never reaches the device-code callback (the provider refused the request) fails
   * here rather than leaving a pending attempt nobody can act on.
   */
  async start(provider: string): Promise<AttemptView> {
    const id = randomUUID();
    const abort = new AbortController();
    const attempt: Attempt = {
      id,
      provider,
      state: "pending",
      createdAt: Date.now(),
      abort,
    };
    this.attempts.set(id, attempt);

    let announced: ((info: DeviceCodeInfo) => void) | undefined;
    let announceFailed: ((err: unknown) => void) | undefined;
    const deviceCode = new Promise<DeviceCodeInfo>((resolve, reject) => {
      announced = resolve;
      announceFailed = reject;
    });

    const flow = this.login({
      signal: abort.signal,
      onDeviceCode: (info) => {
        attempt.userCode = info.userCode;
        attempt.verificationUri = info.verificationUri;
        attempt.intervalSeconds =
          info.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
        attempt.expiresAt = info.expiresInSeconds
          ? Date.now() + info.expiresInSeconds * 1000
          : undefined;
        announced?.(info);
      },
    });

    // The flow's own outcome is recorded whenever it settles, which is usually long after this
    // method has returned. `void` is deliberate: the caller waits for the device code, not for the
    // user. The catch below is what keeps an unhandled rejection out of the process.
    void flow
      .then((credentials) => {
        // `type` is what Pi's own AuthStorage stamps on an OAuth credential before writing it, and
        // the vault stores the file-ready shape, so it is added here rather than three layers on.
        attempt.login = { type: "oauth", ...credentials } as SubscriptionLogin;
        this.settle(attempt, "succeeded");
      })
      .catch((err) => {
        if (abort.signal.aborted) {
          this.settle(attempt, "cancelled");
          return;
        }
        const reason = safeErrorReason(err);
        attempt.error = reason;
        this.settle(attempt, reason === "timed_out" ? "expired" : "failed");
        announceFailed?.(err);
      });

    try {
      await deviceCode;
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
    return this.view(attempt, false);
  }

  /**
   * Read an attempt, handing out the login on EVERY read while it is succeeded. Undefined when the
   * id is unknown, which includes an attempt that was purged.
   *
   * The credential leaves this process at DELETE, which the API sends after it has stored the login
   * durably.
   */
  get(id: string): AttemptView | undefined {
    const attempt = this.attempts.get(id);
    if (!attempt) return undefined;
    const deliverNow = attempt.state === "succeeded" && attempt.login !== undefined;
    if (deliverNow) {
      observeSubscription(this.log, "subscription.attempt", {
        attempt: id,
        state: attempt.state,
        delivered: true,
      });
    }
    return this.view(attempt, deliverNow);
  }

  /**
   * End an attempt and forget it, dropping the credential with it. Idempotent: an unknown id is a
   * no-op, like a repeated DELETE.
   *
   * This is BOTH halves of the DELETE route: the API sends it to abandon a pending login AND to
   * purge a succeeded one it has now stored. The second half is what bounds the token's residency
   * in this process, so it clears `login` explicitly rather than relying on the map entry going
   * away.
   */
  cancel(id: string): void {
    const attempt = this.attempts.get(id);
    if (!attempt) return;
    attempt.abort.abort();
    attempt.login = undefined;
    if (attempt.purgeTimer) clearTimeout(attempt.purgeTimer);
    this.attempts.delete(id);
    observeSubscription(this.log, "subscription.attempt", {
      attempt: id,
      state: "cancelled",
    });
  }

  /** Test seam: how many attempts the map still holds. */
  size(): number {
    return this.attempts.size;
  }

  private settle(attempt: Attempt, state: AttemptState): void {
    // A cancel already removed the attempt; the flow settling afterwards must not resurrect it.
    if (!this.attempts.has(attempt.id)) return;
    attempt.state = state;
    observeSubscription(this.log, "subscription.attempt", {
      attempt: attempt.id,
      state,
    });
    this.schedulePurge(attempt);
  }

  /**
   * Forget the attempt after the purge window, whatever its state.
   *
   * This is the backstop, not the main path: a cancel removes the entry outright. The timer covers
   * the caller that starts a login and walks away, so an unread credential cannot sit in memory for
   * the life of the process.
   */
  private schedulePurge(attempt: Attempt): void {
    if (attempt.purgeTimer) clearTimeout(attempt.purgeTimer);
    attempt.purgeTimer = setTimeout(() => {
      attempt.login = undefined;
      this.attempts.delete(attempt.id);
    }, this.purgeMs);
    // The runner must be able to exit with an attempt outstanding.
    attempt.purgeTimer.unref?.();
  }

  private view(attempt: Attempt, withLogin: boolean): AttemptView {
    const view: AttemptView = {
      attemptId: attempt.id,
      state: attempt.state,
    };
    if (attempt.userCode) view.userCode = attempt.userCode;
    if (attempt.verificationUri) view.verificationUri = attempt.verificationUri;
    if (attempt.expiresAt) view.expiresAt = new Date(attempt.expiresAt).toISOString();
    if (attempt.intervalSeconds) view.intervalSeconds = attempt.intervalSeconds;
    if (withLogin && attempt.login) view.login = attempt.login;
    if (attempt.error) view.error = attempt.error;
    return view;
  }
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
    shared = new SubscriptionLoginAttempts(login);
  }
  return shared;
}

/** Test seam: install a store with an injected login function. */
export function setSubscriptionLoginAttempts(
  store: SubscriptionLoginAttempts | undefined,
): void {
  shared = store;
}
