/**
 * D23: the journey state has to belong to one attempt.
 *
 * `reconnect` is read twice and only at mount — the reducer's lazy initializer and the ref
 * holding the endpoint. The settings section keeps the component rendered and toggles `open`,
 * and `destroyOnClose` destroys the modal's children rather than the component that owns the
 * hook, so a second opening inherited the first one's state. Reconnect then opened at URL
 * entry with no endpoint bound, which repairs nothing and, carried through, would have made a
 * second connection to the same server.
 *
 * These assert what a mount is for: a reconnect starts bound to its connection, and a fresh
 * one starts at the beginning.
 */
import {act, createElement} from "react"

import {useMcpConnectJourney} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {probeMcpUrl, discoverMcpConnect, editMcpEndpoint, listMcpTools, queryMcpEndpoints} =
    vi.hoisted(() => ({
        probeMcpUrl: vi.fn(),
        discoverMcpConnect: vi.fn(),
        editMcpEndpoint: vi.fn(),
        listMcpTools: vi.fn(),
        queryMcpEndpoints: vi.fn(),
    }))

vi.mock("../../../agenta-entities/src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../agenta-entities/src/mcpEndpoint/api/api")>()),
    probeMcpUrl,
    discoverMcpConnect,
    editMcpEndpoint,
    listMcpTools,
    queryMcpEndpoints,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
    useSetAtom: () => async () => undefined,
}))

type Journey = ReturnType<typeof useMcpConnectJourney>
type Reconnect = NonNullable<Parameters<typeof useMcpConnectJourney>[0]>["reconnect"]

const EXISTING = {
    id: "mcp-9",
    slug: "acme-prod",
    name: "Acme (prod)",
    url: "https://mcp.acme.test/",
    authMode: "oauth" as const,
}

const KEY_AUTHENTICATED = {...EXISTING, authMode: "api_key" as const}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let journey: Journey

const mountJourney = async (reconnect: Reconnect = null) => {
    const Probe = () => {
        journey = useMcpConnectJourney({reconnect})
        return null
    }
    await act(async () => {
        root.render(createElement(Probe))
    })
    await act(async () => {
        await Promise.resolve()
    })
}

const unmountJourney = async () => {
    await act(async () => {
        root.render(null)
    })
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    probeMcpUrl.mockResolvedValue({
        count: 1,
        probe: {reachable: true, server_name: "Acme", auth: {mode: "none", scopes_offered: []}},
    })
    discoverMcpConnect.mockResolvedValue({count: 1, scopes_offered: ["tools:list"]})
    editMcpEndpoint.mockResolvedValue({count: 1, endpoint: {id: "mcp-9", slug: "acme-prod"}})
    listMcpTools.mockResolvedValue([{name: "echo"}])
    // The row read back before a credential is written, because the edit route replaces the
    // document rather than merging it.
    queryMcpEndpoints.mockResolvedValue({
        count: 1,
        endpoints: [
            {
                id: "mcp-9",
                slug: "acme-prod",
                name: "Acme (prod)",
                auth_mode: "api_key",
                data: {route: {base_url: "https://mcp.acme.test/"}},
            },
        ],
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("a reconnect", () => {
    it("starts bound to the connection it is repairing, not at URL entry", async () => {
        await mountJourney(EXISTING)

        expect(journey.state.status).toBe("discovering_scopes")
        expect(journey.state.endpointId).toBe("mcp-9")
        expect(journey.state.slug).toBe("acme-prod")
        expect(journey.state.url).toBe(EXISTING.url)
    })

    it("keeps the name someone chose, so discovery cannot overwrite it", async () => {
        await mountJourney(EXISTING)

        expect(journey.state.name).toBe("Acme (prod)")
        expect(journey.state.nameTouched).toBe(true)
    })

    it("never asks for the URL again, and checks the saved one only to offer OAuth", async () => {
        await mountJourney(EXISTING)

        // In the background: the address is the connection's, so no screen asks for it.
        expect(probeMcpUrl).toHaveBeenCalledWith("https://mcp.acme.test/", "project-1")
        expect(journey.state.status).toBe("discovering_scopes")
        expect(journey.state.probe).toBeNull()
    })

    it("lets a key connection switch to OAuth where the saved address publishes it", async () => {
        // A GitHub connection made with a personal token, whose server also signs in with
        // OAuth. The check of the saved address is what makes OAuth selectable.
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {reachable: true, auth: {mode: "oauth", scopes_offered: []}},
        })
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await Promise.resolve()
        })
        expect(journey.state.oauthOffered).toBe(true)

        await act(async () => journey.selectAuthMode("oauth"))
        expect(journey.state.status).toBe("discovering_scopes")
        await act(async () => {
            await journey.startScopeDiscovery()
        })

        // The same row moves to OAuth before the consent route, which refuses any other mode.
        expect(editMcpEndpoint).toHaveBeenCalledWith(
            expect.objectContaining({id: "mcp-9", auth_mode: "oauth", secret_id: null}),
            "project-1",
        )
        expect(discoverMcpConnect).toHaveBeenCalledWith("mcp-9", "project-1")
    })

    it("keeps OAuth off where the saved address does not publish it", async () => {
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => journey.selectAuthMode("oauth"))

        expect(journey.state.oauthOffered).toBe(false)
        expect(journey.state.authMode).toBe("api_key")
    })

    it("cannot delete the connection it is repairing", async () => {
        await mountJourney(EXISTING)
        await act(async () => {
            await journey.cancel()
        })

        // The row was someone's working server before this journey touched it.
        expect(journey.state.createdHere).toBe(false)
    })
})

describe("None chosen on a reconnect", () => {
    const NEEDS_A_KEY = {
        count: 1,
        probe: {
            reachable: true,
            auth: {mode: "unknown", challenge_status: 401, challenge_schemes: ["Bearer"]},
            problem: {cause: "auth_undiscoverable", message: "The server requires authorization."},
        },
    }
    const ANSWERS_WITHOUT_A_KEY = {
        count: 1,
        probe: {reachable: true, auth: {mode: "none", scopes_offered: []}},
    }

    it("writes nothing when the server refuses a connection without a key", async () => {
        // QA: the mode was written first, so a refusal left the row on None with no secret.
        probeMcpUrl.mockResolvedValue(NEEDS_A_KEY)
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => journey.selectAuthMode("none"))
        await act(async () => {
            await journey.skipAuthentication()
        })

        // The saved auth_mode and secret_id stay, because nothing was written.
        expect(editMcpEndpoint).not.toHaveBeenCalled()
        expect(journey.state.status).toBe("verify_failed")
        expect(journey.state.failureStatus).toBe(401)
    })

    it("asks the server without a key first, and writes None once it answers", async () => {
        probeMcpUrl.mockResolvedValueOnce(NEEDS_A_KEY).mockResolvedValueOnce(ANSWERS_WITHOUT_A_KEY)
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => journey.selectAuthMode("none"))
        await act(async () => {
            await journey.skipAuthentication()
        })

        expect(probeMcpUrl).toHaveBeenCalledTimes(2)
        expect(editMcpEndpoint).toHaveBeenCalledWith(
            expect.objectContaining({id: "mcp-9", auth_mode: "none", secret_id: null}),
            "project-1",
        )
        expect(journey.state.status).toBe("saving")
    })

    it("takes the saved address's answer over the saved mode", async () => {
        // Context7: saved with a key, but its address answers without one.
        probeMcpUrl.mockResolvedValue(ANSWERS_WITHOUT_A_KEY)
        await mountJourney(KEY_AUTHENTICATED)
        expect(journey.state.savedUrlProbe?.auth.mode).toBe("none")

        await act(async () => journey.selectAuthMode("none"))
        await act(async () => {
            await journey.skipAuthentication()
        })

        // The server already answered without a key, so it is not asked again.
        expect(probeMcpUrl).toHaveBeenCalledTimes(1)
        expect(editMcpEndpoint).toHaveBeenCalledWith(
            expect.objectContaining({auth_mode: "none"}),
            "project-1",
        )
        expect(journey.state.status).toBe("saving")
    })
})

describe("a new attempt after one has run", () => {
    it("starts at URL entry with nothing carried over", async () => {
        await mountJourney(EXISTING)
        expect(journey.state.endpointId).toBe("mcp-9")

        await unmountJourney()
        await mountJourney(null)

        expect(journey.state.status).toBe("url_entry")
        expect(journey.state.endpointId).toBeNull()
        expect(journey.state.url).toBe("")
        expect(journey.state.name).toBe("")
    })

    it("binds the connection a second reconnect names, not the first", async () => {
        await mountJourney(EXISTING)

        await unmountJourney()
        await mountJourney({
            id: "mcp-10",
            slug: "acme-staging",
            name: "Acme (staging)",
            url: "https://staging.acme.test/",
        })

        expect(journey.state.endpointId).toBe("mcp-10")
        expect(journey.state.slug).toBe("acme-staging")
    })
})

describe("repairing a key-authenticated connection", () => {
    it("asks for the credential rather than for scopes it has none of", async () => {
        await mountJourney(KEY_AUTHENTICATED)

        // Sending this one to scope discovery earns the route's refusal that it is not an
        // OAuth target, which is a dead end on the only action offered to repair it.
        expect(journey.state.status).toBe("manual_auth")
        expect(discoverMcpConnect).not.toHaveBeenCalled()
    })

    it("asks the server whether the credential works before saying it connected", async () => {
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "x-api-key"}, secretId: "sec-1"})
        })

        // Saving a reference to a secret proves nothing about the secret.
        expect(editMcpEndpoint).toHaveBeenCalled()
        expect(listMcpTools).toHaveBeenCalledWith("acme-prod", "project-1")
        expect(journey.state.status).toBe("saving")
    })

    it("reports the server's refusal instead of reading as connected", async () => {
        // A status, because that is what makes it the server's verdict on this credential
        // rather than a failure to reach it (round 4, D133 reopened).
        listMcpTools.mockRejectedValue({
            response: {status: 401, data: {detail: "The server rejected this key."}},
        })
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "x-api-key"}, secretId: "wrong"})
        })

        // Before this the journey said connected and the run failed much later.
        expect(journey.state.status).toBe("verify_failed")
        expect(journey.state.error).toBeTruthy()
    })
})

describe("where a credential check that got no answer lands", () => {
    it("shows the check's own failure rather than claiming a rejection", async () => {
        // The screen that says "the server rejected this key" is for a verdict on the key.
        // A timeout is not one, and the sentence was asserting a rejection that did not
        // happen, with a number taken from a different request (round 4, D133 reopened).
        listMcpTools.mockRejectedValue(new Error("socket hang up"))
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "x-api-key"}, secretId: "sec-1"})
        })

        expect(journey.state.status).toBe("check_failed")
        expect(journey.state.failureStatus).toBeNull()
    })

    it("keeps the server's verdict where the server gave one", async () => {
        listMcpTools.mockRejectedValue({
            response: {status: 403, data: {detail: "Forbidden for this key."}},
        })
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "x-api-key"}, secretId: "sec-1"})
        })

        expect(journey.state.status).toBe("verify_failed")
        expect(journey.state.failureStatus).toBe(403)
        // And the server's own words, which the screen shows beside the code.
        expect(journey.state.error).toContain("Forbidden for this key.")
    })

    it("does not read our own call's 401 as the server's verdict on the key", async () => {
        // The internal read that fetches the row happens BEFORE the relay call, and only the
        // relay carries the chosen server's answer about the credential. A session that
        // expired makes this read answer 401; classified as the relay's it reads as the
        // server rejecting a key it was never shown. The body is shaped like a third party's
        // on purpose, so nothing but the call it came from can tell them apart (D184, D185).
        queryMcpEndpoints.mockRejectedValue({
            response: {status: 401, data: {detail: "The server rejected this key."}},
        })
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "x-api-key"}, secretId: "sec-1"})
        })

        expect(journey.state.status).toBe("check_failed")
        expect(journey.state.failureStatus).toBeNull()
        // And the relay was never reached, so there is no verdict to report either way.
        expect(listMcpTools).not.toHaveBeenCalled()
    })

    it("treats a gateway 502 as a failure to check, not a refusal", async () => {
        listMcpTools.mockRejectedValue({
            response: {status: 502, data: {detail: "Upstream unavailable."}},
        })
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "x-api-key"}, secretId: "sec-1"})
        })

        expect(journey.state.status).toBe("check_failed")
    })
})

describe("what a key reconnect sends back", () => {
    /** The row as the project stores it, carrying more than this step knows about. */
    const STORED = {
        id: "mcp-9",
        slug: "acme-prod",
        name: "Acme (prod)",
        description: "The production account.",
        auth_mode: "api_key" as const,
        secret_id: "sec-old",
        data: {
            route: {base_url: "https://mcp.acme.test/", headers: {"x-trace": "on"}},
            tools: {allow: ["search"]},
        },
        flags: {is_valid: true},
    }

    it("sends the whole document, so the tool filter survives the repair", async () => {
        // The edit route replaces rather than merges. Sending only the fields this step knows
        // about dropped the filter, and the filter is the gateway's only enforcement point,
        // so a reconnect widened what the server may run (round 4, D114).
        queryMcpEndpoints.mockResolvedValue({count: 1, endpoints: [STORED]})
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "x-api-key"}, secretId: "sec-new"})
        })

        const sent = editMcpEndpoint.mock.calls.at(-1)?.[0]
        expect(sent.data.tools).toEqual({allow: ["search"]})
        expect(sent.data.route.headers).toEqual({"x-trace": "on"})
        expect(sent.description).toBe("The production account.")
        expect(sent.flags).toEqual({is_valid: true})
        // And the credential is the one thing it changed.
        expect(sent.secret_id).toBe("sec-new")
        expect(sent.data.route.credential_binding).toEqual({
            kind: "header",
            name: "x-api-key",
            prefix: null,
        })
    })

    it("changes nothing when the row cannot be read back", async () => {
        // Writing a partial document here is the defect; refusing is the safe answer, because
        // the alternative silently unconstrains a connection.
        queryMcpEndpoints.mockResolvedValue({count: 0, endpoints: []})
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "x-api-key"}, secretId: "sec-new"})
        })

        expect(editMcpEndpoint).not.toHaveBeenCalled()
        expect(journey.state.status).not.toBe("saving")
    })
})

describe("a session that expired during the credential submit", () => {
    it("reports the check failing, not the server rejecting a key it never saw", async () => {
        // The submit reads our own API before it reaches the relay, and a session that
        // expired makes that read answer 401. Classified as the relay's, it read as the
        // server rejecting a credential it had never been shown (round 4, D184).
        queryMcpEndpoints.mockRejectedValue({
            response: {status: 401, data: {detail: "Unauthorized"}},
        })

        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "X-Api-Key"}, secretId: "sec-1"})
        })

        expect(journey.state.status).toBe("check_failed")
        expect(journey.state.failureStatus).toBeNull()
        // And nothing was written on the way, because the read never succeeded.
        expect(editMcpEndpoint).not.toHaveBeenCalled()
        expect(listMcpTools).not.toHaveBeenCalled()
    })

    it("reports it the same way when the session goes between the read and the relay", async () => {
        // The residual the shape rule is for: the relay call itself answers 401, but with
        // our own middleware's body rather than a server's.
        listMcpTools.mockRejectedValue({
            response: {status: 401, data: {detail: "Unauthorized"}},
        })

        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "X-Api-Key"}, secretId: "sec-1"})
        })

        expect(journey.state.status).toBe("check_failed")
    })

    it("still calls a bare relayed 401 what it is, and names it", async () => {
        // An API-key connection's refusal is passed through bare, so this is the server's
        // answer even though the status matches ours.
        listMcpTools.mockRejectedValue({
            response: {status: 401, data: {error: "invalid_api_key"}},
        })

        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "X-Api-Key"}, secretId: "sec-1"})
        })

        expect(journey.state.status).toBe("verify_failed")
        expect(journey.state.failureStatus).toBe(401)
    })
})

describe("a reconnect abandoned while the row is being read", () => {
    it("writes nothing and verifies nothing", async () => {
        // Reading the row back is a round trip, and the guard ran only after the write and
        // the verification resolved, so a reconnect closed during that read went on to write
        // a credential and check it against a connection nobody was looking at (round 4,
        // D181).
        let release: (value: unknown) => void = () => undefined
        queryMcpEndpoints.mockReturnValue(
            new Promise((resolve) => {
                release = resolve
            }),
        )

        await mountJourney(KEY_AUTHENTICATED)
        let submitted: Promise<void>
        await act(async () => {
            submitted = journey.submitManualCredential({
                binding: {kind: "header", name: "X-Api-Key"},
                secretId: "sec-1",
            })
        })

        await act(async () => journey.abandonAttempt())
        await act(async () => {
            release({count: 1, endpoints: [{id: "mcp-9", slug: "acme-prod", data: {route: {}}}]})
            await submitted
        })

        expect(editMcpEndpoint).not.toHaveBeenCalled()
        expect(listMcpTools).not.toHaveBeenCalled()
    })
})

describe("a credential swap that worked", () => {
    it("clears the stale validity flag, so the row stops asking to be repaired", async () => {
        // The flag describes the secret being replaced, so carrying it back marked a
        // repaired connection as still needing input and the row went on reading "Login
        // expired" after a successful swap (round 4, D180).
        queryMcpEndpoints.mockResolvedValue({
            count: 1,
            endpoints: [
                {
                    id: "mcp-9",
                    slug: "acme-prod",
                    name: "Acme (prod)",
                    auth_mode: "api_key",
                    secret_id: "sec-old",
                    flags: {is_valid: false},
                    data: {route: {base_url: "https://mcp.acme.test/"}},
                },
            ],
        })

        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({binding: {kind: "header", name: "X-Api-Key"}, secretId: "sec-new"})
        })

        expect(editMcpEndpoint.mock.calls.at(-1)?.[0].flags).toEqual({is_valid: true})
    })
})
