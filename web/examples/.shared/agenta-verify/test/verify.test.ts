/**
 * Unit tests for @agenta/spike-verify.
 *
 * These tests mock Agenta entirely via a stubbed AgentaApiClient. They lock
 * the polling/timeout/error logic in isolation. The integration test (Phase 1
 * LOCK against a real Agenta endpoint) catches API-shape drift — that's a
 * different test target.
 *
 * Test setup:
 *   stubClient: configurable mock of AgentaApiClient — script its responses
 *               sequentially so we can simulate "slow ingestion" or "5xx then
 *               success" or "always down" in deterministic tests.
 *   manualClock: fake Date.now() advanced manually by tests, so polling time
 *                math doesn't depend on real time.
 *   manualSleep: no-op sleeper that advances the manual clock instead of
 *                actually waiting; keeps tests instantaneous.
 */

import {describe, it, expect, vi} from "vitest"

import {
    verifyTrace,
    VerifyTimeoutError,
    VerifyMismatchError,
    VerifyAgentaUnreachableError,
    type AgentaApiClient,
    type AgentaSpan,
} from "../src/index.js"

// --- test helpers ---

function makeManualClock(start = 1_000_000) {
    let t = start
    return {
        now: () => t,
        advance: (ms: number) => {
            t += ms
        },
    }
}

function makeManualSleeper(clock: {advance: (ms: number) => void}) {
    return async (ms: number) => {
        clock.advance(ms)
    }
}

interface StubResponse {
    httpStatus: number
    spans: AgentaSpan[]
    bodySnippet?: string | null
}

interface StubFailure {
    error: Error
}

type StubScript = (StubResponse | StubFailure)[]

function makeStubClient(script: StubScript): AgentaApiClient & {callCount: () => number} {
    let i = 0
    return {
        callCount: () => i,
        async queryByAttribute(_path, _value) {
            const next = script[Math.min(i, script.length - 1)]
            i += 1
            if ("error" in next) {
                throw next.error
            }
            return {
                httpStatus: next.httpStatus,
                bodySnippet: next.bodySnippet ?? null,
                spans: next.spans,
            }
        },
    }
}

/**
 * Mirrors what Agenta actually returns: attributes are nested under `ag.*`,
 * not flat keys. Tests must reflect that real shape so verifyTrace's path-
 * based attribute lookup is exercised correctly.
 */
const goodSpans: AgentaSpan[] = [
    {
        name: "ai.generateText",
        attributes: {
            ag: {
                model: {id: "gpt-4o-mini"},
                user: {id: "u-test-1"},
                session: {id: "s-test-1"},
                metrics: {tokens: {cumulative: {prompt: 42, completion: 10}}},
            },
        },
    },
    {
        name: "ai.toolCall",
        attributes: {
            ag: {
                tool: {name: "getWeather"},
            },
        },
    },
]

const filter = {path: "ag.user.id", value: "u-test-1"} as const

// --- the 10 tests ---

describe("verifyTrace", () => {
    /** TEST 1 — happy path: spans found on first poll, all attrs match. */
    it("resolves immediately when matching trace + attributes are present on first poll", async () => {
        const clock = makeManualClock()
        const apiClient = makeStubClient([{httpStatus: 200, spans: goodSpans}])

        await verifyTrace({
            filterAttribute: filter,
            expectSpans: ["ai.generateText", "ai.toolCall"],
            expectAttributes: {
                "ag.model.id": "gpt-4o-mini",
                "ag.user.id": "u-test-1",
            },
            apiClient,
            timeoutMs: 5000,
            pollIntervalMs: 1000,
            now: clock.now,
            sleep: makeManualSleeper(clock),
        })

        expect(apiClient.callCount()).toBe(1)
    })

    /** TEST 2 — timeout: spans never arrive within window. Throws VerifyTimeoutError with full polling history. */
    it("throws VerifyTimeoutError with full polling history when window expires without a match", async () => {
        const clock = makeManualClock()
        const apiClient = makeStubClient([{httpStatus: 200, spans: []}])

        let caught: unknown
        try {
            await verifyTrace({
                filterAttribute: filter,
                expectSpans: ["ai.generateText"],
                apiClient,
                timeoutMs: 5000,
                pollIntervalMs: 1000,
                now: clock.now,
                sleep: makeManualSleeper(clock),
            })
            throw new Error("verifyTrace should have thrown VerifyTimeoutError")
        } catch (err) {
            caught = err
        }

        expect(caught).toBeInstanceOf(VerifyTimeoutError)
        const e = caught as VerifyTimeoutError
        expect(e.serviceName).toBe(`${filter.path}=${filter.value}`)
        expect(e.timeoutMs).toBe(5000)
        expect(e.pollingHistory.length).toBeGreaterThan(0)
        for (const attempt of e.pollingHistory) {
            expect(typeof attempt.ts).toBe("number")
        }
    })

    /** TEST 3 — agenta unreachable: max consecutive failures fires VerifyAgentaUnreachableError. */
    it("throws VerifyAgentaUnreachableError after max consecutive fetch failures", async () => {
        const clock = makeManualClock()
        const apiClient = makeStubClient([{error: new Error("ECONNREFUSED 127.0.0.1:8080")}])

        let caught: unknown
        try {
            await verifyTrace({
                filterAttribute: filter,
                expectSpans: ["ai.generateText"],
                apiClient,
                timeoutMs: 60_000,
                pollIntervalMs: 1000,
                maxConsecutiveFailures: 3,
                now: clock.now,
                sleep: makeManualSleeper(clock),
            })
            throw new Error("verifyTrace should have thrown VerifyAgentaUnreachableError")
        } catch (err) {
            caught = err
        }

        expect(caught).toBeInstanceOf(VerifyAgentaUnreachableError)
        const e = caught as VerifyAgentaUnreachableError
        expect(e.attemptCount).toBe(3)
        expect(e.lastFetchError).toContain("ECONNREFUSED")
    })

    /** TEST 4 — attribute mismatch: spans found but attrs wrong. Throws VerifyMismatchError with diff. */
    it("throws VerifyMismatchError with readable diff when attributes do not match", async () => {
        const clock = makeManualClock()
        const apiClient = makeStubClient([{httpStatus: 200, spans: goodSpans}])

        try {
            await verifyTrace({
                filterAttribute: filter,
                expectSpans: ["ai.generateText"],
                expectAttributes: {
                    "ag.user.id": "u-WRONG",
                },
                apiClient,
                timeoutMs: 5000,
                pollIntervalMs: 1000,
                now: clock.now,
                sleep: makeManualSleeper(clock),
            })
            throw new Error("verifyTrace should have thrown but resolved")
        } catch (err) {
            expect(err).toBeInstanceOf(VerifyMismatchError)
            const e = err as VerifyMismatchError
            expect(e.mismatches).toHaveLength(1)
            expect(e.mismatches[0].key).toBe("ag.user.id")
            expect(e.mismatches[0].actual).toBe("u-test-1")
            expect(e.mismatches[0].expected).toBe("u-WRONG")
            expect(e.message).toContain("ag.user.id")
            expect(e.message).toContain("u-test-1")
        }
    })

    /** TEST 5 — regex matcher: passes when actual matches the regex. */
    it("supports RegExp attribute matchers", async () => {
        const clock = makeManualClock()
        const apiClient = makeStubClient([{httpStatus: 200, spans: goodSpans}])

        await verifyTrace({
            filterAttribute: filter,
            expectSpans: ["ai.generateText"],
            expectAttributes: {
                "ag.model.id": /^gpt-4o/,
            },
            apiClient,
            timeoutMs: 5000,
            pollIntervalMs: 1000,
            now: clock.now,
            sleep: makeManualSleeper(clock),
        })
    })

    /** TEST 6 — predicate matcher: passes when predicate returns true. */
    it("supports predicate attribute matchers", async () => {
        const clock = makeManualClock()
        const apiClient = makeStubClient([{httpStatus: 200, spans: goodSpans}])

        await verifyTrace({
            filterAttribute: filter,
            expectSpans: ["ai.generateText"],
            expectAttributes: {
                "ag.metrics.tokens.cumulative.prompt": (n: unknown) =>
                    typeof n === "number" && n > 0,
            },
            apiClient,
            timeoutMs: 5000,
            pollIntervalMs: 1000,
            now: clock.now,
            sleep: makeManualSleeper(clock),
        })
    })

    /** TEST 7 — predicate that throws: error is caught + reported in mismatch reason, NOT propagated. */
    it("catches predicate exceptions and surfaces them in mismatch reason", async () => {
        const clock = makeManualClock()
        const apiClient = makeStubClient([{httpStatus: 200, spans: goodSpans}])

        try {
            await verifyTrace({
                filterAttribute: filter,
                expectSpans: ["ai.generateText"],
                expectAttributes: {
                    "ag.user.id": (() => {
                        throw new Error("boom in predicate")
                    }) as (v: unknown) => boolean,
                },
                apiClient,
                timeoutMs: 5000,
                pollIntervalMs: 1000,
                now: clock.now,
                sleep: makeManualSleeper(clock),
            })
            throw new Error("verifyTrace should have thrown VerifyMismatchError")
        } catch (err) {
            expect(err).toBeInstanceOf(VerifyMismatchError)
            const e = err as VerifyMismatchError
            expect(e.mismatches[0].reason).toContain("predicate threw")
            expect(e.mismatches[0].reason).toContain("boom in predicate")
        }
    })

    /** TEST 8 — eventual consistency: empty on first poll, full on second. Should keep polling. */
    it("keeps polling when spans are empty (in-flight ingestion) and resolves when they arrive", async () => {
        const clock = makeManualClock()
        const apiClient = makeStubClient([
            {httpStatus: 200, spans: []},
            {httpStatus: 200, spans: []},
            {httpStatus: 200, spans: goodSpans},
        ])

        await verifyTrace({
            filterAttribute: filter,
            expectSpans: ["ai.generateText"],
            apiClient,
            timeoutMs: 30_000,
            pollIntervalMs: 1000,
            now: clock.now,
            sleep: makeManualSleeper(clock),
        })

        expect(apiClient.callCount()).toBe(3)
    })

    /** TEST 9 — transient 5xx then success: consecutiveFailures resets on a 200, doesn't trip unreachable error. */
    it("resets consecutive-failure counter on a successful response (transient 5xx tolerated)", async () => {
        const clock = makeManualClock()
        const apiClient = makeStubClient([
            {httpStatus: 502, spans: [], bodySnippet: "Bad Gateway"},
            {httpStatus: 503, spans: [], bodySnippet: "Service Unavailable"},
            {httpStatus: 200, spans: []}, // resets the counter
            {httpStatus: 502, spans: [], bodySnippet: "Bad Gateway again"},
            {httpStatus: 502, spans: [], bodySnippet: "Bad Gateway"},
            {httpStatus: 200, spans: goodSpans}, // resolves
        ])

        await verifyTrace({
            filterAttribute: filter,
            expectSpans: ["ai.generateText"],
            apiClient,
            timeoutMs: 30_000,
            pollIntervalMs: 1000,
            maxConsecutiveFailures: 3,
            now: clock.now,
            sleep: makeManualSleeper(clock),
        })
    })

    /** TEST 10 — partial spans: trace exists but expectedSpans not fully present. Keep polling, don't throw mismatch. */
    it("keeps polling when expected span set is incomplete (does NOT misclassify as mismatch)", async () => {
        const clock = makeManualClock()
        const partialSpans: AgentaSpan[] = [goodSpans[0]]
        const apiClient = makeStubClient([
            {httpStatus: 200, spans: partialSpans},
            {httpStatus: 200, spans: goodSpans},
        ])

        await verifyTrace({
            filterAttribute: filter,
            expectSpans: ["ai.generateText", "ai.toolCall"],
            apiClient,
            timeoutMs: 30_000,
            pollIntervalMs: 1000,
            now: clock.now,
            sleep: makeManualSleeper(clock),
        })

        expect(apiClient.callCount()).toBe(2)
    })
})

// --- defensive: input validation ---

describe("verifyTrace input validation", () => {
    it("throws on missing filterAttribute", async () => {
        await expect(
            verifyTrace({
                filterAttribute: {path: "", value: ""},
                expectSpans: ["x"],
                apiClient: makeStubClient([{httpStatus: 200, spans: []}]),
            }),
        ).rejects.toThrow(/filterAttribute.*required/)
    })

    it("throws on empty expectSpans", async () => {
        await expect(
            verifyTrace({
                filterAttribute: filter,
                expectSpans: [],
                apiClient: makeStubClient([{httpStatus: 200, spans: []}]),
            }),
        ).rejects.toThrow(/expectSpans.*at least one/)
    })

    it("throws when neither apiClient nor host+apiKey provided", async () => {
        await expect(
            verifyTrace({
                filterAttribute: filter,
                expectSpans: ["y"],
            }),
        ).rejects.toThrow(/apiClient.*host.*apiKey/)
    })
})

void vi
