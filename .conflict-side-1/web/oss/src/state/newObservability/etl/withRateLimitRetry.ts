/**
 * withRateLimitRetry — wraps an async transport call so an HTTP 429 from EE
 * throttling pauses and retries instead of killing the batch-add scan.
 *
 * EE's throttling service returns 429 with a `Retry-After` header (seconds)
 * and a "...retry after N seconds." detail message. This honors the
 * `Retry-After`, retries up to `maxRetries`, and aborts cleanly mid-wait.
 * Once the cap is hit the original error rethrows — the run then ends with a
 * partial add, which the UI surfaces with a Retry action.
 */

const DEFAULT_MAX_RETRIES = 6
const DEFAULT_DELAY_MS = 10_000
/** Cap so a bad `Retry-After` can't stall the run for minutes. */
const MAX_DELAY_MS = 60_000

export interface RateLimitRetryOptions {
    /** Max retry attempts for this call. Default 6. */
    maxRetries?: number
    /** Wait used when a 429 carries no `Retry-After`, ms. Default 10 000. */
    defaultDelayMs?: number
    /** Cancels the wait between retries. */
    signal?: AbortSignal
    /** Fired before each wait — `delayMs` is the wait, `attempt` is 1-based. */
    onRetry?: (delayMs: number, attempt: number) => void
}

/** True when `err` looks like an HTTP 429, across the error shapes we see. */
const isRateLimitError = (err: unknown): boolean => {
    const e = err as {status?: number; response?: {status?: number}; message?: string} | null
    if (e?.status === 429 || e?.response?.status === 429) return true
    const message = (e?.message ?? "").toLowerCase()
    return message.includes("rate limit") || message.includes("too many requests")
}

/**
 * Retry delay (ms) for a 429 — the `Retry-After` header, else the seconds
 * parsed from the detail message, else the fallback. Capped at `MAX_DELAY_MS`.
 */
const getRetryDelayMs = (err: unknown, fallbackMs: number): number => {
    const e = err as {response?: {headers?: Record<string, unknown>}; message?: string} | null

    const headers = e?.response?.headers
    const headerValue = headers?.["retry-after"] ?? headers?.["Retry-After"]
    const headerSeconds =
        typeof headerValue === "number"
            ? headerValue
            : typeof headerValue === "string"
              ? Number.parseInt(headerValue, 10)
              : NaN

    let delayMs = fallbackMs
    if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
        delayMs = headerSeconds * 1000
    } else {
        const match = (e?.message ?? "").match(/retry after (\d+)\s*second/i)
        if (match) {
            const seconds = Number.parseInt(match[1], 10)
            if (Number.isFinite(seconds) && seconds > 0) delayMs = seconds * 1000
        }
    }
    return Math.min(delayMs, MAX_DELAY_MS)
}

/** Abortable sleep — rejects with `AbortError` if the signal fires first. */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"))
            return
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        const onAbort = () => {
            if (timer !== undefined) clearTimeout(timer)
            reject(new DOMException("Aborted", "AbortError"))
        }
        timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort)
            resolve()
        }, ms)
        signal?.addEventListener("abort", onAbort, {once: true})
    })

/**
 * Run `fn`, retrying on HTTP 429 with the server's `Retry-After` backoff.
 * Non-rate-limit errors, and rate-limit errors past `maxRetries`, rethrow.
 */
export const withRateLimitRetry = async <T>(
    fn: () => Promise<T>,
    {
        maxRetries = DEFAULT_MAX_RETRIES,
        defaultDelayMs = DEFAULT_DELAY_MS,
        signal,
        onRetry,
    }: RateLimitRetryOptions = {},
): Promise<T> => {
    let attempt = 0
    while (true) {
        try {
            return await fn()
        } catch (err) {
            if (!isRateLimitError(err) || attempt >= maxRetries) throw err
            attempt += 1
            const delayMs = getRetryDelayMs(err, defaultDelayMs)
            onRetry?.(delayMs, attempt)
            await sleep(delayMs, signal)
        }
    }
}
