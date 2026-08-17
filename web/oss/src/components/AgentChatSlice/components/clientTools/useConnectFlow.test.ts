/**
 * Unit tests for the pure helpers in `useConnectFlow` — the connect-mode resolver (bug: a
 * toolkit with no Composio-managed OAuth, e.g. telegram, was always attempted as "oauth"
 * and 404'd), the mode-resolving guard (CodeRabbit finding on #5909: `resolveConnectMode`'s
 * "keep the hint while loading" fallback is fine for the RENDER, but a click landing in that
 * same window must not be allowed to fire a request with the raw, unverified hint), and the
 * error-message extractor (bug: a create failure settled the parked call silently, with no
 * error surfaced anywhere — see ConnectToolWidget.test / the ConnectToolWidget
 * KNOWN_CONNECT_REASONS branch this message feeds).
 */
import {describe, expect, it} from "vitest"

import {
    connectFailureFrom,
    extractConnectErrorMessage,
    isConnectModeResolving,
    isConnectionAlreadyExists,
    settledFailureChip,
    resolveConnectMode,
} from "./useConnectFlow"

describe("resolveConnectMode", () => {
    it("RENDER fallback: keeps the hint when the catalog has no auth_schemes yet (loading, or backend reported none) — `isConnectModeResolving` below is what stops a click from acting on this before it's verified", () => {
        expect(resolveConnectMode("oauth", undefined)).toBe("oauth")
        expect(resolveConnectMode("oauth", null)).toBe("oauth")
        expect(resolveConnectMode("api_key", [])).toBe("api_key")
    })

    it("keeps the hint when the toolkit actually supports it", () => {
        expect(resolveConnectMode("oauth", ["oauth"])).toBe("oauth")
        expect(resolveConnectMode("api_key", ["api_key"])).toBe("api_key")
        expect(resolveConnectMode("oauth", ["oauth", "api_key"])).toBe("oauth")
    })

    it("telegram case: an 'oauth' hint against a toolkit with only api_key falls back to api_key", () => {
        expect(resolveConnectMode("oauth", ["api_key"])).toBe("api_key")
    })

    it("the reverse: an 'api_key' hint against an oauth-only toolkit falls back to oauth", () => {
        expect(resolveConnectMode("api_key", ["oauth"])).toBe("oauth")
    })
})

describe("isConnectModeResolving", () => {
    it("blocks: a real integration key, the catalog lookup in flight, not timed out — the exact window a click must not act in", () => {
        expect(
            isConnectModeResolving({
                hasIntegrationKey: true,
                queryIsLoading: true,
                timedOut: false,
            }),
        ).toBe(true)
    })

    it("unblocks once the lookup settles (success or error) — queryIsLoading flips false", () => {
        expect(
            isConnectModeResolving({
                hasIntegrationKey: true,
                queryIsLoading: false,
                timedOut: false,
            }),
        ).toBe(false)
    })

    it("unblocks for a malformed call with no integration key, even mid-'loading' — a disabled TanStack Query reports isLoading:true forever, which must not permanently disable Connect", () => {
        expect(
            isConnectModeResolving({
                hasIntegrationKey: false,
                queryIsLoading: true,
                timedOut: false,
            }),
        ).toBe(false)
    })

    it("unblocks once timed out, even if the query is still loading — a stuck lookup (dead network) cannot latch the button disabled forever", () => {
        expect(
            isConnectModeResolving({hasIntegrationKey: true, queryIsLoading: true, timedOut: true}),
        ).toBe(false)
    })
})

describe("extractConnectErrorMessage", () => {
    it("prefers the backend's detail string on a 4xx", () => {
        const err = {
            statusCode: 422,
            body: {detail: "telegram requires custom OAuth credentials in this environment."},
        }
        expect(extractConnectErrorMessage(err)).toBe(
            "telegram requires custom OAuth credentials in this environment.",
        )
    })

    it("falls back to a generic message on a 5xx even with a detail present", () => {
        const err = {statusCode: 502, body: {detail: "upstream exploded"}}
        expect(extractConnectErrorMessage(err)).toBe("Connection failed. Please try again.")
    })

    it("falls back to a generic message when there is no parseable body/detail", () => {
        expect(extractConnectErrorMessage(new Error("network down"))).toBe(
            "Connection failed. Please try again.",
        )
        expect(extractConnectErrorMessage({statusCode: 422, body: {}})).toBe(
            "Connection failed. Please try again.",
        )
        expect(extractConnectErrorMessage(null)).toBe("Connection failed. Please try again.")
    })
})

/**
 * The duplicate-connection dead end found in live QA (2026-08-10): when the project already holds a
 * connection for the toolkit, `POST /tools/connections/` answers 409 whose `detail` is the platform
 * CONFLICT ENVELOPE — an object, not a string. The extractor only read the string form, so the card
 * showed "Connection failed. Please try again.", the settle reason carried that same non-reason to
 * the agent, and Retry re-fired the identical doomed create forever.
 */
describe("a duplicate connection (409)", () => {
    const conflictError = (conflict?: Record<string, unknown>) => ({
        statusCode: 409,
        body: {
            detail: {
                message: "A resource with slug 'telegram' already exists in this project.",
                ...(conflict ? {conflict} : {}),
            },
        },
    })

    it("names the integration from the conflict envelope", () => {
        expect(
            extractConnectErrorMessage(
                conflictError({
                    provider_key: "composio",
                    integration_key: "telegram",
                    slug: "telegram",
                }),
            ),
        ).toBe("A connection for telegram already exists in this project.")
    })

    it("falls back to the server's own message when the conflict names no integration", () => {
        expect(extractConnectErrorMessage(conflictError())).toBe(
            "A resource with slug 'telegram' already exists in this project.",
        )
    })

    it("still says what happened when the 409 carries no usable body at all", () => {
        expect(extractConnectErrorMessage({statusCode: 409, body: {}})).toBe(
            "A connection for this integration already exists in this project.",
        )
    })

    it("never reports the generic failure for a 409", () => {
        for (const err of [
            conflictError(),
            conflictError({integration_key: "gmail"}),
            {statusCode: 409},
        ]) {
            expect(extractConnectErrorMessage(err)).not.toBe("Connection failed. Please try again.")
        }
    })

    it("is the one failure Retry cannot fix", () => {
        expect(isConnectionAlreadyExists(conflictError())).toBe(true)
        expect(isConnectionAlreadyExists({statusCode: 422, body: {detail: "nope"}})).toBe(false)
        expect(isConnectionAlreadyExists(new Error("network down"))).toBe(false)
    })

    it("gives the card and the settle reason the SAME message, and drops Retry", () => {
        // The catch block feeds `setErrorText` and the settle `reason` from this one value, so the
        // agent reads exactly what the user reads.
        const failure = connectFailureFrom(
            conflictError({integration_key: "telegram", slug: "telegram"}),
        )

        expect(failure.message).toBe("A connection for telegram already exists in this project.")
        expect(failure.retryable).toBe(false)
    })

    it("keeps Retry for failures a retry could actually fix", () => {
        expect(connectFailureFrom({statusCode: 422, body: {detail: "popup blocked"}})).toEqual({
            message: "popup blocked",
            retryable: true,
        })
        expect(connectFailureFrom(new Error("network down")).retryable).toBe(true)
    })

    it("reads an object detail on other 4xx codes too", () => {
        expect(
            extractConnectErrorMessage({
                statusCode: 422,
                body: {detail: {message: "custom OAuth credentials are required."}},
            }),
        ).toBe("custom OAuth credentials are required.")
    })
})

/**
 * Review round 3 finding 2: the PARKED card's 409 goes through `finish()`, so the render takes the
 * SETTLED branch — `phase` is back to `idle` and `errorRetryable` is never read there. The settled
 * branch has to make its own decision, and it must survive a reload, where only the stored output
 * is left.
 */
/**
 * Review round 3 finding 2 and the round-5 defect both land here: the PARKED card's failure goes
 * through `finish()`, so the render takes the SETTLED branch — which returns before the
 * `phase === "error"` branch, making that branch unreachable once settled. Everything the chip
 * shows after a settle, including a post-settle retry's result, has to come through here.
 */
describe("settledFailureChip", () => {
    it("drops Retry when the live outcome says the failure cannot be retried", () => {
        expect(settledFailureChip({retryable: false}, {}).retryable).toBe(false)
    })

    it("drops Retry after a reload, from the stored output alone", () => {
        expect(settledFailureChip(null, {retryable: false}).retryable).toBe(false)
    })

    it("keeps Retry for an ordinary failure", () => {
        expect(settledFailureChip({retryable: true}, {retryable: true}).retryable).toBe(true)
        expect(settledFailureChip(null, {}).retryable).toBe(true)
        expect(settledFailureChip(undefined, undefined).retryable).toBe(true)
    })

    it("keeps Retry for outputs written before the flag existed", () => {
        expect(settledFailureChip(null, {reason: "cancelled"}).retryable).toBe(true)
    })

    it("renders generic wording for the three expected non-error reasons", () => {
        for (const reason of ["declined", "cancelled", "timeout"]) {
            expect(settledFailureChip(null, {reason}).failureDetail).toBeUndefined()
        }
    })

    it("renders any other reason verbatim", () => {
        expect(
            settledFailureChip(null, {
                reason: "A connection for gmail already exists in this project.",
            }).failureDetail,
        ).toBe("A connection for gmail already exists in this project.")
    })

    it("the round-5 repro: a doomed retry from an abandoned-OAuth card stops offering Retry", () => {
        // The stored output is the abandoned connect: reason "cancelled", no flag — so before the
        // fix the chip kept its generic wording and a Retry that 409'd forever (QA reqid 4913/4919).
        const abandoned = {connected: false, reason: "cancelled"}
        expect(settledFailureChip(null, abandoned)).toEqual({
            failureDetail: undefined,
            retryable: true,
        })

        // After the failed retry refreshes the live outcome, the chip tells the truth and drops Retry.
        const afterDoomedRetry = {
            connected: false,
            reason: "A connection for gmail already exists in this project.",
            retryable: false,
        }
        expect(settledFailureChip(afterDoomedRetry, abandoned)).toEqual({
            failureDetail: "A connection for gmail already exists in this project.",
            retryable: false,
        })
    })

    it("lets the live outcome override a stale stored output", () => {
        expect(settledFailureChip({retryable: false}, {retryable: true}).retryable).toBe(false)
    })
})
