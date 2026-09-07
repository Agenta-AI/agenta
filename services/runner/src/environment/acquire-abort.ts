/**
 * Cancellation helpers for environment acquisition.
 *
 * A user Stop can arrive while a provider or mount call is still pending. Waiting for that call
 * before observing the signal makes the control delivery time out. Racing without compensating
 * cleanup is worse: a provider may finish creating a sandbox after the turn has already ended.
 * These helpers provide the shared race and the late-success cleanup hook used by those stages.
 */

/** The stable error shape returned when acquisition is interrupted by its turn signal. */
export class AcquireAbortedError extends Error {
  constructor() {
    super("Sandbox acquisition was aborted.");
    this.name = "AbortError";
  }
}

export function throwIfAcquireAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AcquireAbortedError();
}

export interface AbortableAcquireHooks<T> {
  /** Cleanup for a resource that materialized after the caller already observed cancellation. */
  onLateSuccess?: (value: T) => void | Promise<void>;
  /** Cleanup for a known resource whose operation failed after cancellation. */
  onLateFailure?: (error: unknown) => void | Promise<void>;
}

function runLateHook<T>(
  hook: ((value: T) => void | Promise<void>) | undefined,
  value: T,
): void {
  if (!hook) return;
  void Promise.resolve()
    .then(() => hook(value))
    .catch(() => {});
}

/**
 * Start one acquire operation and reject as soon as `signal` aborts. The underlying operation is
 * not assumed to support AbortSignal, so a resource that resolves later is handed to the cleanup
 * hook instead of being leaked or published to the cancelled caller.
 */
export function waitForAcquire<T>(
  start: () => Promise<T>,
  signal?: AbortSignal,
  hooks: AbortableAcquireHooks<T> = {},
): Promise<T> {
  if (!signal) return start();
  throwIfAcquireAborted(signal);

  return new Promise<T>((resolve, reject) => {
    let cancelled = false;
    let settled = false;
    const onAbort = () => {
      if (settled || cancelled) return;
      cancelled = true;
      reject(new AcquireAbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });

    let operation: Promise<T>;
    try {
      operation = start();
    } catch (error) {
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(error);
      return;
    }

    operation.then(
      (value) => {
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (cancelled) {
          runLateHook(hooks.onLateSuccess, value);
          return;
        }
        resolve(value);
      },
      (error) => {
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (cancelled) {
          runLateHook(hooks.onLateFailure, error);
          return;
        }
        reject(error);
      },
    );

    // Cover an abort that raced the listener registration and operation start.
    if (signal.aborted) onAbort();
  });
}
