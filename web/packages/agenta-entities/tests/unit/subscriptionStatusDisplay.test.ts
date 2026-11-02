/**
 * The runner subscription-status mapping: which message the self-managed credentials card shows
 * for each combination of query state, runner state, and per-harness login state.
 *
 * The strings are the contract with docs/design/runner-subscription-status/api-design.md
 * ("Frontend display"), so they are asserted literally — a reworded message must be a deliberate
 * edit here, not a silent drift.
 */
import {describe, expect, it} from "vitest"

import {
    resolveSubscriptionStatus,
    subscriptionStatusKey,
} from "../../src/workflow/state/subscriptionStatus"

const CONNECTED = (state: string) => ({
    runner: "connected" as const,
    checked_at: "2026-08-12T12:00:00Z",
    harnesses: {codex: {state, provider: "openai"}},
})

/** A settled query for `codex` carrying `data`. */
const settled = (data: Parameters<typeof resolveSubscriptionStatus>[0]["data"]) =>
    resolveSubscriptionStatus({harness: "codex", isLoading: false, isError: false, data})

describe("subscriptionStatusKey", () => {
    it("keys on the harness under the self-managed mode", () => {
        expect(subscriptionStatusKey({mode: "self_managed", harness: "codex"})).toBe("codex")
    })

    it("stays idle under the API-key mode", () => {
        expect(subscriptionStatusKey({mode: "agenta", harness: "codex"})).toBe("")
    })

    it("stays idle with no harness selected, and with no mode at all", () => {
        expect(subscriptionStatusKey({mode: "self_managed", harness: null})).toBe("")
        expect(subscriptionStatusKey({mode: "self_managed", harness: ""})).toBe("")
        expect(subscriptionStatusKey({mode: null, harness: "codex"})).toBe("")
        expect(subscriptionStatusKey({mode: undefined, harness: undefined})).toBe("")
    })
})

describe("resolveSubscriptionStatus", () => {
    it("shows nothing while the query is idle", () => {
        const status = resolveSubscriptionStatus({
            harness: "",
            isLoading: false,
            isError: false,
            data: undefined,
        })
        expect(status).toEqual({message: null, tone: "neutral", loading: false})
    })

    it("shows the loading message while checking", () => {
        const status = resolveSubscriptionStatus({
            harness: "codex",
            isLoading: true,
            isError: false,
            data: undefined,
        })
        expect(status.message).toBe("Checking the runner…")
        expect(status.loading).toBe(true)
    })

    it("shows the loading message before the first answer lands", () => {
        expect(settled(undefined).message).toBe("Checking the runner…")
    })

    it("shows the check-failed message when the request rejects", () => {
        const status = resolveSubscriptionStatus({
            harness: "codex",
            isLoading: false,
            isError: true,
            data: undefined,
        })
        expect(status).toEqual({
            message: "Agenta could not check the runner.",
            tone: "error",
            loading: false,
        })
    })

    it("shows the check-failed message when the payload failed the boundary schema", () => {
        expect(settled(null).message).toBe("Agenta could not check the runner.")
    })

    it("maps every connected harness state to its message", () => {
        expect(settled(CONNECTED("ready"))).toEqual({
            message: "Subscription login found",
            tone: "success",
            loading: false,
        })
        expect(settled(CONNECTED("not_configured"))).toEqual({
            message: "Runner found. Subscription folder is not configured.",
            tone: "warning",
            loading: false,
        })
        expect(settled(CONNECTED("login_missing"))).toEqual({
            message: "Runner found. Login file is missing.",
            tone: "warning",
            loading: false,
        })
        expect(settled(CONNECTED("login_unusable"))).toEqual({
            message: "Runner found. Login file cannot be used.",
            tone: "error",
            loading: false,
        })
    })

    it("maps an unreachable runner and an old runner to their own messages", () => {
        expect(settled({runner: "unavailable"})).toEqual({
            message: "Runner is not connected.",
            tone: "warning",
            loading: false,
        })
        expect(settled({runner: "incompatible"})).toEqual({
            message: "Update the runner to check subscription status.",
            tone: "warning",
            loading: false,
        })
    })

    it("asks for a runner update when the harness cannot be checked", () => {
        // `unsupported`, an absent entry, and a state this build does not know are the same story
        // to the user: this runner cannot answer for this harness.
        expect(settled(CONNECTED("unsupported")).message).toBe(
            "Update the runner to check subscription status.",
        )
        expect(settled({runner: "connected", harnesses: {}}).message).toBe(
            "Update the runner to check subscription status.",
        )
        expect(settled({runner: "connected"}).message).toBe(
            "Update the runner to check subscription status.",
        )
        expect(settled(CONNECTED("gone_fishing")).message).toBe(
            "Update the runner to check subscription status.",
        )
    })

    it("reads the state of the selected harness, not of a sibling", () => {
        const data = {
            runner: "connected" as const,
            harnesses: {
                codex: {state: "ready", provider: "openai"},
                claude: {state: "login_missing", provider: "anthropic"},
            },
        }
        expect(settled(data).message).toBe("Subscription login found")
        expect(
            resolveSubscriptionStatus({
                harness: "claude",
                isLoading: false,
                isError: false,
                data,
            }).message,
        ).toBe("Runner found. Login file is missing.")
    })

    it("never claims the subscription itself is verified", () => {
        const ready = settled(CONNECTED("ready")).message ?? ""
        expect(ready).not.toMatch(/verified|valid|active/i)
    })
})
