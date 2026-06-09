/**
 * Three typed errors for spike verification failures. Each preserves enough
 * context that a failing assertion is its own bug report — the engineer can
 * read the error message and know exactly what went wrong without re-running.
 */

export interface PollAttempt {
    /** Unix epoch ms when this attempt fired. */
    ts: number
    /** HTTP status returned by Agenta API. `null` if the fetch itself failed. */
    httpStatus: number | null
    /** Up to ~500 chars of the response body for diagnostic. */
    bodySnippet: string | null
    /** Set when the underlying fetch threw (network down, DNS fail, etc.). */
    fetchError?: string
}

/**
 * Polling exhausted the timeout window without ever finding a matching trace.
 * Includes the full attempt history so the engineer can see ingestion lag,
 * intermittent 5xx responses, etc.
 */
export class VerifyTimeoutError extends Error {
    public readonly serviceName: string
    public readonly timeoutMs: number
    public readonly pollingHistory: PollAttempt[]

    constructor(opts: {serviceName: string; timeoutMs: number; pollingHistory: PollAttempt[]}) {
        const summary = summarizeHistory(opts.pollingHistory)
        super(
            `VerifyTimeoutError: no matching trace for service.name=${opts.serviceName} ` +
                `within ${opts.timeoutMs}ms (${opts.pollingHistory.length} polls). ${summary}`,
        )
        this.name = "VerifyTimeoutError"
        this.serviceName = opts.serviceName
        this.timeoutMs = opts.timeoutMs
        this.pollingHistory = opts.pollingHistory
    }
}

/**
 * Trace was found but one or more expected attributes don't match. Includes
 * the diff between expected and actual so the engineer can see the gap.
 */
export class VerifyMismatchError extends Error {
    public readonly serviceName: string
    public readonly expected: Record<string, unknown>
    public readonly actual: Record<string, unknown>
    public readonly mismatches: AttributeMismatch[]

    constructor(opts: {
        serviceName: string
        expected: Record<string, unknown>
        actual: Record<string, unknown>
        mismatches: AttributeMismatch[]
    }) {
        const diff = opts.mismatches
            .map(
                (m) =>
                    `  - ${m.key}: expected ${describeMatcher(m.expected)}, got ${JSON.stringify(m.actual)}` +
                    (m.reason ? ` (${m.reason})` : ""),
            )
            .join("\n")
        super(
            `VerifyMismatchError: service.name=${opts.serviceName} trace found but ${opts.mismatches.length} attribute(s) failed:\n${diff}`,
        )
        this.name = "VerifyMismatchError"
        this.serviceName = opts.serviceName
        this.expected = opts.expected
        this.actual = opts.actual
        this.mismatches = opts.mismatches
    }
}

export interface AttributeMismatch {
    key: string
    expected: unknown
    actual: unknown
    /** Optional explanation when the matcher itself surfaced a reason (e.g. "predicate threw: <message>"). */
    reason?: string
}

/**
 * Fetch to the Agenta API failed at the network/transport level. Distinct
 * from `VerifyTimeoutError` (which means "polling completed but no match")
 * — this means "we never got a response we could even evaluate."
 */
export class VerifyAgentaUnreachableError extends Error {
    public readonly serviceName: string
    public readonly attemptCount: number
    public readonly lastHttpStatus: number | null
    public readonly lastResponseBody: string | null
    public readonly lastFetchError?: string

    constructor(opts: {
        serviceName: string
        attemptCount: number
        lastHttpStatus: number | null
        lastResponseBody: string | null
        lastFetchError?: string
    }) {
        super(
            `VerifyAgentaUnreachableError: Agenta API unreachable after ${opts.attemptCount} attempts. ` +
                `Last status=${opts.lastHttpStatus ?? "n/a"}, fetchError=${opts.lastFetchError ?? "none"}.`,
        )
        this.name = "VerifyAgentaUnreachableError"
        this.serviceName = opts.serviceName
        this.attemptCount = opts.attemptCount
        this.lastHttpStatus = opts.lastHttpStatus
        this.lastResponseBody = opts.lastResponseBody
        this.lastFetchError = opts.lastFetchError
    }
}

// --- internals ---

function describeMatcher(m: unknown): string {
    if (m instanceof RegExp) return `match ${m.toString()}`
    if (typeof m === "function") return `predicate ${m.name || "<anonymous>"}`
    return JSON.stringify(m)
}

function summarizeHistory(history: PollAttempt[]): string {
    if (history.length === 0) return "no attempts recorded"
    const last = history[history.length - 1]
    const failures = history.filter((a) => a.httpStatus !== null && a.httpStatus >= 400).length
    const fetchErrors = history.filter((a) => a.fetchError).length
    return (
        `Last status=${last.httpStatus ?? "n/a"}, ` +
        `4xx/5xx count=${failures}, ` +
        `fetch errors=${fetchErrors}.`
    )
}
