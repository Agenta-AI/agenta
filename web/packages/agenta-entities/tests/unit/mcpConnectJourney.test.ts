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
    adoptableEndpoint,
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

    it("keeps what the probe answered, so the failure can name its cause", () => {
        // The screen reads `problem.cause` to choose between "couldn't reach this server" and
        // "reached the address, but it isn't an MCP server". Dropping the probe here leaves
        // every failure wearing the unreachable wording, including the ones that answered.
        const failed = run(
            {type: "url_changed", url: URL},
            {type: "submit_url"},
            {
                type: "probe_failed",
                error: "The address answered, but not with an MCP handshake (HTTP 200).",
                probe: {
                    reachable: true,
                    auth: {mode: "unknown", scopes_offered: []},
                    problem: {
                        cause: "not_an_mcp_server",
                        message: "The address answered, but not with an MCP handshake (HTTP 200).",
                    },
                },
            },
        )

        expect(failed.probe?.problem?.cause).toBe("not_an_mcp_server")
    })

    it("carries no probe when the check never got an answer to carry", () => {
        // A thrown refusal and the client-side bound both fail without one, and the screen
        // falls back to the unreachable wording rather than reading a stale probe.
        const failed = run(
            {type: "url_changed", url: URL},
            {type: "submit_url"},
            {type: "probe_failed", error: "The server could not be checked."},
        )

        expect(failed.probe).toBeNull()
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

describe("a name the project has already taken", () => {
    it("goes back to the name, not to a generic retry", () => {
        // Retrying a create_failed would submit the same name and be refused the same way.
        const refused = run(...beforeCreate("oauth"), {
            type: "name_taken",
            error: "Another connection in this project already uses this name.",
        })

        expect(refused.status).toBe("naming")
        expect(refused.error).toContain("already uses this name")
    })

    it("keeps the URL and the probe, so only the name has to change", () => {
        const refused = run(...beforeCreate("oauth"), {type: "name_taken", error: "taken"})

        expect(refused.url).toBe(URL)
        expect(refused.probe).not.toBeNull()
    })

    it("clears the refusal as soon as the name is edited", () => {
        const refused = run(...beforeCreate("oauth"), {type: "name_taken", error: "taken"})
        const edited = journeyReducer(refused, {type: "name_changed", name: "Acme (work)"})

        expect(edited.error).toBeNull()
        expect(edited.nameTouched).toBe(true)
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
            authMode: "oauth",
        })
        const offered = journeyReducer(reconnecting, {
            type: "scopes_discovered",
            scopes: ["tools:list", "tools:call", "tools:write"],
        })

        expect(offered.scopesOffered).toContain("tools:write")
        expect(offered.scopesSelected).toContain("tools:write")
    })
})

describe("cancelling after consent has succeeded", () => {
    it("deletes nothing, because the grant already exists", () => {
        // The exchange happens in the callback, server-side. By `saving` the provider has
        // issued the credential, so deleting the row here orphans it there.
        const saved = run(...upToConsent(), {type: "consent_succeeded"})

        expect(saved.status).toBe("saving")
        expect(isConnected(saved)).toBe(true)
        expect(cancelDeletesEndpoint(saved)).toBe(false)
    })

    it("still deletes a pending row that never got that far", () => {
        const waiting = run(...upToConsent())

        expect(cancelDeletesEndpoint(waiting)).toBe(true)
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
            authMode: "oauth",
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
            authMode: "oauth",
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
        // The retry is the caller re-submitting the credential, not a transition: `verifying`
        // is busy and nothing in the reducer drives it (D30).
        expect(journeyReducer(failed, {type: "retry"})).toBe(failed)
    })
})

describe("token revoked", () => {
    it("reconnects on the existing connection, preserving its identity", () => {
        const state = startReconnect({
            id: "mcp-9",
            slug: "acme",
            name: "Acme (main)",
            url: URL,
            authMode: "oauth",
        })

        expect(state.endpointId).toBe("mcp-9")
        expect(state.slug).toBe("acme")
        expect(state.name).toBe("Acme (main)")
        // The name is the person's, so discovery must not touch it on the way back.
        expect(state.nameTouched).toBe(true)
    })
})

describe("reconnecting a connection that authorizes with a key", () => {
    it("goes to the credential step, not to scope discovery", () => {
        // A key-authenticated connection has no scopes to re-read, and the connect route
        // refuses it outright, so scope discovery is a dead end on the only repair offered.
        const state = startReconnect({
            id: "mcp-9",
            slug: "acme",
            name: "Acme",
            url: URL,
            authMode: "api_key",
        })

        expect(state.status).toBe("manual_auth")
        expect(state.endpointId).toBe("mcp-9")
    })

    it("treats a connection needing nothing the same way", () => {
        const state = startReconnect({
            id: "mcp-9",
            slug: "acme",
            name: "Acme",
            url: URL,
            authMode: "none",
        })

        expect(state.status).toBe("manual_auth")
    })
})

describe("retrying a failure", () => {
    it("moves only where something will drive it", () => {
        // `creating` and `verifying` are busy states nothing re-invokes, so a retry that
        // moved there replaced the error with a spinner that never resolved and disabled both
        // buttons. Those two are retried by calling the operation again instead.
        const createFailed = run(...beforeCreate("oauth"), {
            type: "create_failed",
            error: "x",
        })
        expect(journeyReducer(createFailed, {type: "retry"})).toBe(createFailed)

        const verifyFailed = run(
            ...upToCreated("unknown"),
            {type: "verify_started"},
            {type: "verify_failed", error: "x"},
        )
        expect(journeyReducer(verifyFailed, {type: "retry"})).toBe(verifyFailed)
    })

    it("still moves from the failures whose target has one", () => {
        const checkFailed = run(
            {type: "url_changed", url: URL},
            {type: "submit_url"},
            {type: "probe_failed", error: "x"},
        )
        expect(journeyReducer(checkFailed, {type: "retry"}).status).toBe("checking_url")

        const scopesFailed = run(...upToCreated("oauth"), {type: "scopes_failed", error: "x"})
        expect(journeyReducer(scopesFailed, {type: "retry"}).status).toBe("discovering_scopes")
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

describe("the row a refused name belongs to", () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
        id: "mcp-1",
        slug: "acme-7mx",
        name: "Acme",
        data: {route: {base_url: "https://mcp.acme.test"}},
        ...overrides,
    })

    it("is the one whose name and address both match what is being connected", () => {
        expect(adoptableEndpoint([row()], {name: "Acme", url: "https://mcp.acme.test"})?.id).toBe(
            "mcp-1",
        )
    })

    it("ignores a trailing slash, the case and the surrounding space in the address", () => {
        // The create sends a trimmed URL and the row comes back as the API stored it, so the
        // two spellings of one address must not read as two servers.
        expect(
            adoptableEndpoint([row()], {name: "Acme", url: "  HTTPS://MCP.Acme.test/  "})?.id,
        ).toBe("mcp-1")
    })

    it("compares names the way the API refuses them", () => {
        // The refusal this answers is the API's, which compares normalized names, so matching
        // the raw string would leave the dead end in place for exactly the names it refuses.
        expect(
            adoptableEndpoint([row()], {name: " acme ", url: "https://mcp.acme.test"}),
        ).toBeNull()
        expect(
            adoptableEndpoint([row({name: "Acme Prod"})], {
                name: "Acme-Prod",
                url: "https://mcp.acme.test",
            })?.id,
        ).toBe("mcp-1")
    })

    it("is nothing when the name matches a different server", () => {
        // A real collision. Continuing into that row would connect the person to a server they
        // did not name, which is worse than making them choose another label.
        expect(
            adoptableEndpoint([row()], {name: "Acme", url: "https://mcp.somewhere-else.test"}),
        ).toBeNull()
    })

    it("is nothing for a row with no address, no identity, or no list at all", () => {
        expect(adoptableEndpoint([row({data: {}})], {name: "Acme", url: URL})).toBeNull()
        expect(adoptableEndpoint([row({id: null})], {name: "Acme", url: URL})).toBeNull()
        expect(adoptableEndpoint([row({slug: ""})], {name: "Acme", url: URL})).toBeNull()
        expect(adoptableEndpoint(undefined, {name: "Acme", url: URL})).toBeNull()
        expect(adoptableEndpoint([row()], {name: "   ", url: URL})).toBeNull()
    })
})

describe("Abandoning one authorization attempt", () => {
    const waiting = (mode: "oauth" | "none" | "unknown" = "oauth") =>
        run(
            ...upToCreated(mode),
            {type: "scopes_discovered", scopes: ["tools:list"]},
            {type: "submit_scopes"},
        )

    it("goes back to the name, keeping it and the row", () => {
        // Cancelling the provider's window abandons an attempt, not the connection being
        // made: retyping the address and the name to try a second time is a punishment for
        // a sign-in someone closed.
        const state = journeyReducer(waiting(), {type: "consent_abandoned"})

        expect(state.status).toBe("naming")
        expect(state.name).toBe("Acme Tools")
        expect(state.endpointId).toBe("mcp-1")
        expect(state.error).toBeNull()
    })

    it("still owns the row it created, so cancelling the dialog still cleans it up", () => {
        const state = journeyReducer(waiting(), {type: "consent_abandoned"})

        expect(cancelDeletesEndpoint(state)).toBe(true)
    })

    it("does nothing for a reconnect, which has no screen behind it", () => {
        // A reconnect entered at scope discovery and chose nothing. There is no name step to
        // return to, and landing on one would offer to rename a working connection.
        const reconnecting = startReconnect({
            id: "mcp-9",
            slug: "acme-prod",
            name: "Acme (prod)",
            url: URL,
            authMode: "oauth",
        })

        expect(journeyReducer(reconnecting, {type: "consent_abandoned"})).toBe(reconnecting)
    })
})
