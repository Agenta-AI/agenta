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

const {probeMcpUrl, discoverMcpConnect, editMcpEndpoint, listMcpTools} = vi.hoisted(() => ({
    probeMcpUrl: vi.fn(),
    discoverMcpConnect: vi.fn(),
    editMcpEndpoint: vi.fn(),
    listMcpTools: vi.fn(),
}))

vi.mock("../../../agenta-entities/src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../agenta-entities/src/mcpEndpoint/api/api")>()),
    probeMcpUrl,
    discoverMcpConnect,
    editMcpEndpoint,
    listMcpTools,
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

    it("never asks for the URL again, because nothing about the server is being chosen", async () => {
        await mountJourney(EXISTING)

        expect(probeMcpUrl).not.toHaveBeenCalled()
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
            await journey.submitManualCredential({headerName: "x-api-key", secretId: "sec-1"})
        })

        // Saving a reference to a secret proves nothing about the secret.
        expect(editMcpEndpoint).toHaveBeenCalled()
        expect(listMcpTools).toHaveBeenCalledWith("acme-prod", "project-1")
        expect(journey.state.status).toBe("saving")
    })

    it("reports the server's refusal instead of reading as connected", async () => {
        listMcpTools.mockRejectedValue(new Error("Unauthorized"))
        await mountJourney(KEY_AUTHENTICATED)
        await act(async () => {
            await journey.submitManualCredential({headerName: "x-api-key", secretId: "wrong"})
        })

        // Before this the journey said connected and the run failed much later.
        expect(journey.state.status).toBe("verify_failed")
        expect(journey.state.error).toBeTruthy()
    })
})
