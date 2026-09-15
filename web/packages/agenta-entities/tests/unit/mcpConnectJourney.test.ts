/**
 * Every state in the connect journey, including the ones nobody clicks through by hand.
 *
 * The table in docs/design/gateways-research/v1/mcp-connection-ux.md is the specification;
 * each `describe` below is one of its rows. The two invariants asserted repeatedly are the
 * ones that turn a bug into a lost connection or a lie: cancelling must not destroy a
 * working server, and no failure may read as a success.
 */
import {describe, expect, it} from "vitest"

import {
    cancelDeletesEndpoint,
    isBusy,
    isConnected,
    journeyReducer,
    startJourney,
    startReconnect,
    type McpJourneyEvent,
    type McpJourneyState,
} from "../../src/mcpEndpoint/core/connectJourney"
import type {MCPServerProbe} from "../../src/mcpEndpoint/core/types"

const URL = "https://mcp.acme.test/"

const probe = (mode: "oauth" | "none" | "unknown"): MCPServerProbe => ({
    reachable: true,
    server_name: mode === "oauth" ? null : "Acme Tools",
    auth: {mode, scopes_offered: mode === "oauth" ? ["tools:list"] : []},
})

/** Replay a sequence onto a fresh journey. */
const run = (...events: McpJourneyEvent[]): McpJourneyState =>
    events.reduce(journeyReducer, startJourney())

/** The shortest path to a created row, for a server with the given auth mode. */
const upToCreated = (mode: "oauth" | "none" | "unknown"): McpJourneyEvent[] => [
    {type: "url_changed", url: URL},
    {type: "submit_url"},
    {type: "probe_succeeded", probe: probe(mode), suggestedName: "Acme Tools"},
    {type: "submit_name"},
    {type: "endpoint_created", endpointId: "mcp-1", slug: "acme-tools"},
]

/** Everything up to, but not including, the create landing. */
const beforeCreate = (mode: "oauth" | "none" | "unknown"): McpJourneyEvent[] =>
    upToCreated(mode).slice(0, -1)

/** The oauth path from a created row to the point consent is actually requested. */
const upToConsent = (): McpJourneyEvent[] => [
    ...upToCreated("oauth"),
    {type: "scopes_discovered", scopes: ["tools:list", "tools:call"]},
    {type: "submit_scopes"},
]

const connected = (): McpJourneyState =>
    run(...upToConsent(), {type: "consent_succeeded"}, {type: "saved"})

/** Replay a sequence and report the status after each step. */
const trace = (...events: McpJourneyEvent[]): string[] => {
    const statuses: string[] = []
    events.reduce((state, event) => {
        const next = journeyReducer(state, event)
        statuses.push(next.status)
        return next
    }, startJourney())
    return statuses
}

describe("the happy path", () => {
    it("goes URL, name, consent, connected without a second Connect action", () => {
        expect(
            trace(
                {type: "url_changed", url: URL},
                {type: "submit_url"},
                {type: "probe_succeeded", probe: probe("oauth"), suggestedName: "mcp.acme.test"},
                {type: "submit_name"},
                {type: "endpoint_created", endpointId: "mcp-1", slug: "acme"},
                {type: "scopes_discovered", scopes: ["tools:list"]},
                {type: "submit_scopes"},
                {type: "consent_succeeded"},
                {type: "saved"},
                {type: "tools_loaded", tools: [{name: "search"}]},
            ),
        ).toEqual([
            "url_entry",
            "checking_url",
            "naming",
            "creating",
            "discovering_scopes",
            "choosing_scopes",
            "awaiting_consent",
            "saving",
            "discovering_tools",
            "tools_ready",
        ])
    })

    it("keeps the identity the create handed back", () => {
        const state = connected()

        expect(state.endpointId).toBe("mcp-1")
        expect(state.slug).toBe("acme-tools")
    })
})

describe("naming", () => {
    it("suggests, and lets discovery improve a suggestion nobody edited", () => {
        const state = run(
            {type: "url_changed", url: URL},
            {type: "submit_url"},
            {type: "probe_succeeded", probe: probe("none"), suggestedName: "Acme Tools"},
        )

        expect(state.name).toBe("Acme Tools")
        expect(state.nameTouched).toBe(false)
    })

    it("never overwrites a name the person edited", () => {
        const state = run(
            {type: "url_changed", url: URL},
            {type: "name_changed", name: "Acme (work)"},
            {type: "submit_url"},
            {type: "probe_succeeded", probe: probe("none"), suggestedName: "Acme Tools"},
        )

        expect(state.name).toBe("Acme (work)")
    })

    it("refuses to continue without a name", () => {
        const before = run(
            {type: "url_changed", url: URL},
            {type: "submit_url"},
            {type: "probe_succeeded", probe: probe("none"), suggestedName: ""},
        )

        expect(journeyReducer(before, {type: "submit_name"})).toBe(before)
    })

    it("refuses to check an empty URL", () => {
        const before = startJourney()

        expect(journeyReducer(before, {type: "submit_url"})).toBe(before)
    })
})

describe("Checking URL", () => {
    it("shows progress and keeps what was typed", () => {
        const state = run({type: "url_changed", url: URL}, {type: "submit_url"})

        expect(state.status).toBe("checking_url")
        expect(isBusy(state)).toBe(true)
        expect(state.url).toBe(URL)
    })

    it("explains a failure and retries without retyping", () => {
        const failed = run(
            {type: "url_changed", url: URL},
            {type: "submit_url"},
            {type: "probe_failed", error: "The server did not answer."},
        )

        expect(failed.status).toBe("check_failed")
        expect(failed.error).toBe("The server did not answer.")
        expect(failed.url).toBe(URL)

        expect(journeyReducer(failed, {type: "retry"}).status).toBe("checking_url")
    })

    it("forgets what the probe said once the address changes", () => {
        const state = run(...beforeCreate("oauth").slice(0, 3), {
            type: "url_changed",
            url: "https://other.test/",
        })

        expect(state.probe).toBeNull()
        expect(state.status).toBe("url_entry")
    })
})

describe("which authentication the journey asks for", () => {
    it("reads the offered permissions when the probe discovered OAuth", () => {
        expect(run(...upToCreated("oauth")).status).toBe("discovering_scopes")
    })

    it("verifies straight away when the server needs no authentication", () => {
        expect(run(...upToCreated("none")).status).toBe("verifying")
    })

    it("asks rather than guesses when discovery was inconclusive", () => {
        // A 401 is not evidence of an API key, so this is a question, not a key field
        // presented as the obvious next step.
        expect(run(...upToCreated("unknown")).status).toBe("manual_auth")
    })
})

describe("Waiting for consent", () => {
    it("is a pending state, not a connected one", () => {
        const state = run(...upToConsent())

        expect(isBusy(state)).toBe(true)
        expect(isConnected(state)).toBe(false)
    })

    it("treats a cancelled consent as its own outcome, with no success message", () => {
        const state = run(...upToConsent(), {
            type: "consent_cancelled",
            error: "Authorization window closed before completion.",
        })

        expect(state.status).toBe("consent_cancelled")
        expect(isConnected(state)).toBe(false)
        expect(state.error).toContain("closed")
    })

    it("retries onto the same row, so a retry cannot duplicate the connection", () => {
        const cancelled = run(...upToConsent(), {
            type: "consent_cancelled",
            error: "cancelled",
        })
        const retried = journeyReducer(cancelled, {type: "retry"})

        expect(retried.status).toBe("choosing_scopes")
        expect(retried.endpointId).toBe("mcp-1")
        expect(retried.createdHere).toBe(true)
    })

    it("reports a refused authorization without losing the row", () => {
        const failed = run(...upToConsent(), {
            type: "consent_failed",
            error: "User declined",
        })

        expect(failed.status).toBe("consent_failed")
        expect(failed.endpointId).toBe("mcp-1")
        expect(journeyReducer(failed, {type: "retry"}).status).toBe("choosing_scopes")
    })
})

describe("choosing scopes", () => {
    it("pre-checks everything the server offered", () => {
        const state = run(...upToCreated("oauth"), {
            type: "scopes_discovered",
            scopes: ["tools:list", "tools:call"],
        })

        expect(state.status).toBe("choosing_scopes")
        expect(state.scopesSelected).toEqual(["tools:list", "tools:call"])
    })

    it("lets one be dropped and put back", () => {
        const offered = run(...upToCreated("oauth"), {
            type: "scopes_discovered",
            scopes: ["tools:list", "tools:call"],
        })
        const narrowed = journeyReducer(offered, {
            type: "scope_toggled",
            scope: "tools:call",
        })

        expect(narrowed.scopesSelected).toEqual(["tools:list"])
        expect(
            journeyReducer(narrowed, {type: "scope_toggled", scope: "tools:call"}).scopesSelected,
        ).toEqual(["tools:list", "tools:call"])
    })

    it("offers a server with no scopes the same confirmation", () => {
        const state = run(...upToCreated("oauth"), {type: "scopes_discovered", scopes: []})

        expect(state.status).toBe("choosing_scopes")
        expect(state.scopesSelected).toEqual([])
    })

    it("explains a discovery failure and retries it", () => {
        const failed = run(...upToCreated("oauth"), {
            type: "scopes_failed",
            error: "Could not read this server's OAuth configuration.",
        })

        expect(failed.status).toBe("scopes_failed")
        expect(isConnected(failed)).toBe(false)
        expect(journeyReducer(failed, {type: "retry"}).status).toBe("discovering_scopes")
    })

    it("re-reads them on a reconnect, so a step-up is possible", () => {
        const reconnecting = startReconnect({
            id: "mcp-9",
            slug: "acme",
            name: "Acme",
            url: URL,
        })
        const offered = journeyReducer(reconnecting, {
            type: "scopes_discovered",
            scopes: ["tools:list", "tools:call", "tools:write"],
        })

        expect(offered.scopesOffered).toContain("tools:write")
        expect(offered.scopesSelected).toContain("tools:write")
    })
})

describe("cancelling", () => {
    it("deletes the pending row this journey made", () => {
        expect(cancelDeletesEndpoint(run(...upToConsent()))).toBe(true)
    })

    it("deletes nothing before a row exists", () => {
        expect(cancelDeletesEndpoint(run({type: "url_changed", url: URL}))).toBe(false)
    })

    it("never deletes an existing connection during a reconnect", () => {
        const state = startReconnect({
            id: "mcp-9",
            slug: "acme",
            name: "Acme",
            url: URL,
        })

        expect(state.status).toBe("discovering_scopes")
        expect(cancelDeletesEndpoint(state)).toBe(false)
    })

    it("never deletes a connection that already succeeded", () => {
        expect(cancelDeletesEndpoint(connected())).toBe(false)
    })
})

describe("repeated submission", () => {
    it("keeps the first row rather than claiming a second", () => {
        const first = run(...upToConsent())
        const again = journeyReducer(first, {
            type: "endpoint_created",
            endpointId: "mcp-1",
            slug: "acme-tools",
        })

        expect(again.endpointId).toBe("mcp-1")
        expect(again.createdHere).toBe(true)
    })

    it("does not claim ownership of a row it did not create", () => {
        const reconnecting = startReconnect({
            id: "mcp-9",
            slug: "acme",
            name: "Acme",
            url: URL,
        })
        const after = journeyReducer(reconnecting, {
            type: "endpoint_created",
            endpointId: "mcp-9",
            slug: "acme",
        })

        expect(after.createdHere).toBe(false)
        expect(cancelDeletesEndpoint(after)).toBe(false)
    })
})

describe("credentials saved, tools unavailable", () => {
    it("stays connected and offers the tools again, not consent again", () => {
        const state = journeyReducer(connected(), {
            type: "tools_failed",
            error: "The server did not answer tools/list.",
        })

        expect(state.status).toBe("tools_failed")
        expect(isConnected(state)).toBe(true)
        expect(state.error).toContain("tools/list")

        const retried = journeyReducer(state, {type: "retry_tools"})
        expect(retried.status).toBe("discovering_tools")
    })

    it("refuses to retry tools before there is a connection", () => {
        const pending = run(...upToConsent())

        expect(journeyReducer(pending, {type: "retry_tools"})).toBe(pending)
    })
})

describe("no tools returned", () => {
    it("is an empty state, not a transport failure", () => {
        const state = journeyReducer(connected(), {type: "tools_loaded", tools: []})

        expect(state.status).toBe("no_tools")
        expect(isConnected(state)).toBe(true)
        expect(state.error).toBeNull()
    })
})

describe("manual authentication", () => {
    it("can be chosen, verified and connected", () => {
        const manual = run(...upToCreated("unknown"))
        const verifying = journeyReducer(manual, {type: "verify_started"})
        const saved = journeyReducer(verifying, {type: "verify_succeeded"})

        expect(verifying.status).toBe("verifying")
        expect(saved.status).toBe("saving")
        expect(journeyReducer(saved, {type: "saved"}).status).toBe("discovering_tools")
    })

    it("explains a rejected credential and retries the check", () => {
        const failed = run(
            ...upToCreated("unknown"),
            {type: "verify_started"},
            {type: "verify_failed", error: "The server refused that credential."},
        )

        expect(failed.status).toBe("verify_failed")
        expect(isConnected(failed)).toBe(false)
        expect(journeyReducer(failed, {type: "retry"}).status).toBe("verifying")
    })
})

describe("token revoked", () => {
    it("reconnects on the existing connection, preserving its identity", () => {
        const state = startReconnect({
            id: "mcp-9",
            slug: "acme",
            name: "Acme (main)",
            url: URL,
        })

        expect(state.endpointId).toBe("mcp-9")
        expect(state.slug).toBe("acme")
        expect(state.name).toBe("Acme (main)")
        // The name is the person's, so discovery must not touch it on the way back.
        expect(state.nameTouched).toBe(true)
    })
})

describe("no failure reads as a success", () => {
    const failures: McpJourneyState[] = [
        run(
            {type: "url_changed", url: URL},
            {type: "submit_url"},
            {
                type: "probe_failed",
                error: "x",
            },
        ),
        run(...beforeCreate("oauth"), {type: "create_failed", error: "x"}),
        run(...upToConsent(), {type: "consent_cancelled", error: "x"}),
        run(...upToConsent(), {type: "consent_failed", error: "x"}),
        run(...upToCreated("unknown"), {type: "verify_failed", error: "x"}),
    ]

    it("leaves every failure disconnected and explained", () => {
        for (const state of failures) {
            expect(isConnected(state), state.status).toBe(false)
            expect(isBusy(state), state.status).toBe(false)
            expect(state.error, state.status).toBeTruthy()
        }
    })

    it("ignores a retry from a state that has nothing to retry", () => {
        const pending = run(...upToConsent())

        expect(journeyReducer(pending, {type: "retry"})).toBe(pending)
    })
})
