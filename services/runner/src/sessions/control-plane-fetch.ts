/**
 * An idempotent request to the platform's session control plane that a turn depends on: a read, a
 * heartbeat, or a write the API deduplicates (an interaction carries its `token`, unique per
 * session). Only such a request may go through here; one that must not run twice passes
 * `maxAttempts: 1`.
 *
 * A 429 (the platform is throttling) or a 502, 503 or 504 (it is restarting) is not an answer
 * about the session: the request is asked again, after the `Retry-After` the platform named or a
 * jittered exponential back-off. Everything else, a transport error included, is returned at once
 * for the caller to judge: an unreachable platform must not hold a turn for the whole budget.
 * Jitter keeps many turns that were throttled together from coming back together.
 *
 * `budgetMs` (default `CONTROL_PLANE_BUDGET_MS`, the same for every provider) bounds the whole
 * call, attempts and waits together: every attempt gets a signal that fires when the budget is
 * spent, and no wait is started that would end past it. The caller's signal cancels an attempt or
 * a wait at once.
 */

/** How long one control-plane call may take, attempts and waits together. */
export const CONTROL_PLANE_BUDGET_MS = 30_000;

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const FIRST_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4_000;
const RETRY_AFTER_JITTER_MS = 500;

export interface ControlPlaneRetry {
  /** Elapsed time for the whole call: every attempt and every wait between attempts. */
  budgetMs?: number;
  /**
   * An idempotent write whose every failure may be asked again (a transport error or any status
   * but 2xx), within `maxAttempts`: the API deduplicates it.
   */
  retryFailures?: boolean;
  /** At most this many attempts (default: as many as the budget allows). */
  maxAttempts?: number;
  /** Cancels the attempt in flight or the wait, whichever is running. */
  signal?: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

/** Seconds, or an HTTP date, as RFC 9110 allows; undefined when absent or unreadable. */
function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/** How long to wait before the next attempt: what the platform asked for, else jittered back-off. */
export function retryDelayMs(response: Response | undefined, attempt: number, random: () => number = Math.random, now = Date.now()): number {
  const asked = response ? retryAfterMs(response.headers.get("retry-after"), now) : undefined;
  if (asked !== undefined) return asked + random() * RETRY_AFTER_JITTER_MS;
  const ceiling = Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** attempt);
  return ceiling / 2 + (random() * ceiling) / 2;
}

/** `request` builds one attempt (a fresh body each time) and must pass the signal it is given to its fetch. */
export async function fetchControlPlane(
  request: (signal: AbortSignal) => Promise<Response>,
  retry: ControlPlaneRetry = {},
): Promise<Response> {
  const sleep = retry.sleep ?? defaultSleep;
  const random = retry.random ?? Math.random;
  const now = retry.now ?? Date.now;
  const budgetMs = retry.budgetMs ?? CONTROL_PLANE_BUDGET_MS;
  const budget = AbortSignal.timeout(Math.max(1, budgetMs));
  const signal = retry.signal ? AbortSignal.any([retry.signal, budget]) : budget;
  const giveUpAt = now() + budgetMs;
  for (let attempt = 0; ; attempt += 1) {
    const last = attempt + 1 >= (retry.maxAttempts ?? Infinity);
    let response: Response;
    try {
      response = await request(signal);
    } catch (err) {
      if (!retry.retryFailures || last || signal.aborted) throw err;
      const wait = retryDelayMs(undefined, attempt, random, Date.now());
      if (now() + wait >= giveUpAt) throw err;
      await sleep(wait, signal);
      continue;
    }
    if (!RETRYABLE_STATUSES.has(response.status) && !(retry.retryFailures && !response.ok)) return response;
    if (last) return response;
    const wait = retryDelayMs(response, attempt, random, Date.now());
    if (now() + wait >= giveUpAt) return response;
    await response.body?.cancel().catch(() => {});
    await sleep(wait, signal);
  }
}
