/**
 * verifyTrace — the single public function used by every spike app's
 * canonical assertion scripts. Polls the Agenta API for a trace matching
 * `serviceName`, then validates expected spans + attributes are present.
 *
 *   ┌─────────────┐    poll every     ┌─────────────────┐
 *   │ verifyTrace │ ────pollIntervalMs│ Agenta /api/    │
 *   │             │ ────────────────▶ │ spans/query     │
 *   └──────┬──────┘                   └────────┬────────┘
 *          │                                   │
 *          │ found + match? ◀──────────────────┘
 *          │
 *      ┌───┴───┬─────────────┬──────────────────┐
 *     YES    miss-attr     never-found      network-fail
 *      │       │              │                  │
 *   resolve  Mismatch       Timeout         Unreachable
 *           Error           Error            Error
 */

import {createAgentaApiClient, type AgentaApiClient, type AgentaSpan} from "./api.js"
import {
    VerifyAgentaUnreachableError,
    VerifyMismatchError,
    VerifyTimeoutError,
    type AttributeMismatch,
    type PollAttempt,
} from "./errors.js"

export type AttributeMatcher = string | number | boolean | RegExp | ((value: unknown) => boolean)

export interface VerifyOptions {
    /**
     * Attribute path + value used as the SERVER-SIDE filter when querying
     * Agenta. Each spike app's assertion sets a unique value here so the
     * query returns ONLY this run's spans.
     *
     * **Why not `service.name`?** OTel Resource attributes don't survive
     * Agenta's adapter pipeline today (see P-NODE-01 in the pain log).
     * Spike apps must filter on something they control per-call. Common
     * choice: `ag.user.id` set to a unique-per-run UUID.
     */
    filterAttribute: {
        /** Dot-separated path under `attributes`, e.g. "ag.user.id". */
        path: string
        /** Exact-match value at that path. Recommend a unique-per-run string. */
        value: string
    }

    /**
     * Span names that must all be present in the matching trace.
     * Example: `["ai.generateText", "ai.toolCall"]`.
     */
    expectSpans: string[]

    /**
     * Attribute key → matcher. Matcher can be a literal value, a RegExp,
     * or a predicate function. Searched across ALL spans returned for
     * the filter (any one span carrying the attr passes).
     */
    expectAttributes?: Record<string, AttributeMatcher>

    /** How often to poll while waiting for the trace. Default 1000ms. */
    pollIntervalMs?: number

    /** Total time to keep polling before giving up. Default 30000ms. */
    timeoutMs?: number

    /**
     * Maximum CONSECUTIVE network failures before giving up early with
     * `VerifyAgentaUnreachableError`. A single 5xx then success continues;
     * 5 failures in a row implies the API is genuinely down. Default 5.
     */
    maxConsecutiveFailures?: number

    /**
     * Inject a custom API client (used by tests; production code passes
     * `host` and `apiKey` instead).
     */
    apiClient?: AgentaApiClient

    /** Required when `apiClient` is not provided. Defaults to AGENTA_HOST env var inside the SDK. */
    host?: string

    /** Required when `apiClient` is not provided. Defaults to AGENTA_API_KEY env var inside the SDK. */
    apiKey?: string

    /**
     * Agenta project UUID. Threaded into every API request as `?project_id=<uuid>`
     * (Agenta reads it from query params, not headers). Project-scoped API keys
     * make this implicit, but explicit is safer. See SDK-REQ-03 in status.md.
     */
    projectId?: string

    /**
     * Optional sleeper for tests. Production uses the real `setTimeout`.
     */
    sleep?: (ms: number) => Promise<void>

    /**
     * Optional clock for tests. Production uses `Date.now()`.
     */
    now?: () => number
}

/**
 * Resolve when a matching trace is found and all expected spans + attributes
 * are present. Throw a typed error otherwise. See VerifyOptions for the
 * full contract.
 */
export async function verifyTrace(opts: VerifyOptions): Promise<void> {
    if (!opts.filterAttribute || !opts.filterAttribute.path || !opts.filterAttribute.value) {
        throw new Error(
            "verifyTrace: `filterAttribute` is required. Pass `{path, value}` so Agenta knows which spans to return.",
        )
    }
    if (!opts.expectSpans || opts.expectSpans.length === 0) {
        throw new Error("verifyTrace: `expectSpans` must contain at least one span name.")
    }

    const client = opts.apiClient ?? buildDefaultClient(opts)
    const pollIntervalMs = opts.pollIntervalMs ?? 1000
    const timeoutMs = opts.timeoutMs ?? 30_000
    const maxConsecutiveFailures = opts.maxConsecutiveFailures ?? 5
    const sleep = opts.sleep ?? defaultSleep
    const now = opts.now ?? (() => Date.now())

    const startedAt = now()
    const history: PollAttempt[] = []
    let consecutiveFailures = 0

    while (now() - startedAt < timeoutMs) {
        let attempt: PollAttempt
        try {
            const result = await client.queryByAttribute(
                opts.filterAttribute.path,
                opts.filterAttribute.value,
            )
            attempt = {
                ts: now(),
                httpStatus: result.httpStatus,
                bodySnippet: result.bodySnippet,
            }
            history.push(attempt)

            if (result.httpStatus >= 200 && result.httpStatus < 300) {
                consecutiveFailures = 0
                if (result.spans.length > 0) {
                    // Validate expectations against the spans we got.
                    const validation = validateSpans(result.spans, opts)
                    if (validation.ok) {
                        return // SUCCESS
                    }
                    if (validation.kind === "mismatch") {
                        // Trace exists but attributes don't match. Don't keep
                        // polling — re-poll won't change Agenta's stored data.
                        throw new VerifyMismatchError({
                            serviceName: `${opts.filterAttribute.path}=${opts.filterAttribute.value}`,
                            expected: opts.expectAttributes ?? {},
                            actual: validation.actual,
                            mismatches: validation.mismatches,
                        })
                    }
                    // missingSpan: trace exists but span set is incomplete —
                    // could be in-flight ingestion. Keep polling.
                }
                // No spans yet, or partial. Keep polling.
            } else {
                consecutiveFailures += 1
            }
        } catch (err) {
            // Re-throw mismatch immediately; everything else is a fetch failure.
            if (err instanceof VerifyMismatchError) throw err

            attempt = {
                ts: now(),
                httpStatus: null,
                bodySnippet: null,
                fetchError: err instanceof Error ? err.message : String(err),
            }
            history.push(attempt)
            consecutiveFailures += 1
        }

        if (consecutiveFailures >= maxConsecutiveFailures) {
            const last = history[history.length - 1]
            throw new VerifyAgentaUnreachableError({
                serviceName: `${opts.filterAttribute.path}=${opts.filterAttribute.value}`,
                attemptCount: history.length,
                lastHttpStatus: last.httpStatus,
                lastResponseBody: last.bodySnippet,
                lastFetchError: last.fetchError,
            })
        }

        // Wait before next poll, but only if we still have budget.
        if (now() - startedAt + pollIntervalMs < timeoutMs) {
            await sleep(pollIntervalMs)
        } else {
            // No more time — break out and report timeout.
            break
        }
    }

    throw new VerifyTimeoutError({
        serviceName: `${opts.filterAttribute.path}=${opts.filterAttribute.value}`,
        timeoutMs,
        pollingHistory: history,
    })
}

// --- internals ---

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildDefaultClient(opts: VerifyOptions): AgentaApiClient {
    if (!opts.host || !opts.apiKey) {
        throw new Error("verifyTrace: must pass either `apiClient`, or both `host` and `apiKey`.")
    }
    // Hand off transport, retries, error shapes, types to @agenta/sdk.
    // spike-verify is a polling+matching layer on top of the official client.
    return createAgentaApiClient({
        host: opts.host,
        apiKey: opts.apiKey,
        projectId: opts.projectId,
    })
}

type ValidationResult =
    | {ok: true}
    | {ok: false; kind: "missingSpan"; missing: string[]}
    | {
          ok: false
          kind: "mismatch"
          mismatches: AttributeMismatch[]
          actual: Record<string, unknown>
      }

function validateSpans(spans: AgentaSpan[], opts: VerifyOptions): ValidationResult {
    // 1. Check expected span names are all present.
    const presentNames = new Set(spans.map((s) => s.name).filter((n): n is string => Boolean(n)))
    const missing = opts.expectSpans.filter((expected) => !presentNames.has(expected))
    if (missing.length > 0) {
        return {ok: false, kind: "missingSpan", missing}
    }

    // 2. Check each expected attribute against any span's attributes (or the merged set).
    if (!opts.expectAttributes || Object.keys(opts.expectAttributes).length === 0) {
        return {ok: true}
    }

    // Merge attribute objects across all spans (deep merge — Agenta nests
    // attributes under `ag.{data,metrics,user,session,...}` so `expectAttributes`
    // keys like "ag.user.id" need path-based lookup, not flat-key lookup).
    const merged: Record<string, unknown> = {}
    for (const span of spans) {
        if (span.attributes && typeof span.attributes === "object") {
            deepMerge(merged, span.attributes as Record<string, unknown>)
        }
    }

    const mismatches: AttributeMismatch[] = []
    for (const [key, matcher] of Object.entries(opts.expectAttributes)) {
        const actual = readPath(merged, key)
        const result = matchAttribute(actual, matcher)
        if (!result.ok) {
            mismatches.push({key, expected: matcher, actual, reason: result.reason})
        }
    }

    if (mismatches.length > 0) {
        return {ok: false, kind: "mismatch", mismatches, actual: merged}
    }
    return {ok: true}
}

/** Merge `src` into `dst` recursively. Plain-object children are merged; everything else overwrites. */
function deepMerge(dst: Record<string, unknown>, src: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(src)) {
        if (
            v !== null &&
            typeof v === "object" &&
            !Array.isArray(v) &&
            dst[k] !== null &&
            typeof dst[k] === "object" &&
            !Array.isArray(dst[k])
        ) {
            deepMerge(dst[k] as Record<string, unknown>, v as Record<string, unknown>)
        } else {
            dst[k] = v
        }
    }
}

/** Look up a value by dot path. e.g. readPath({ag:{user:{id:"u1"}}}, "ag.user.id") → "u1". */
function readPath(obj: Record<string, unknown>, path: string): unknown {
    let cur: unknown = obj
    for (const seg of path.split(".")) {
        if (cur === null || typeof cur !== "object") return undefined
        cur = (cur as Record<string, unknown>)[seg]
    }
    return cur
}

function matchAttribute(
    actual: unknown,
    matcher: AttributeMatcher,
): {ok: true} | {ok: false; reason?: string} {
    if (matcher instanceof RegExp) {
        if (typeof actual !== "string") {
            return {ok: false, reason: "expected string for regex matcher"}
        }
        return matcher.test(actual) ? {ok: true} : {ok: false}
    }
    if (typeof matcher === "function") {
        try {
            return matcher(actual) ? {ok: true} : {ok: false}
        } catch (err) {
            return {
                ok: false,
                reason: `predicate threw: ${err instanceof Error ? err.message : String(err)}`,
            }
        }
    }
    return actual === matcher ? {ok: true} : {ok: false}
}
