/**
 * D22: a connected journey has to finish.
 *
 * Reaching "connected" moves the journey into `discovering_tools`, which is a busy state, so
 * until something lists the tools both footer buttons stay disabled and the only way out is
 * the dialog's X. The reducer already had `tools_ready`, `no_tools`, `tools_failed` and the
 * retry event, and every one of those transitions passed its own test; the defect was that
 * nothing dispatched them.
 *
 * So these drive the hook rather than the rendered dialog. The hook is where the gap was, and
 * asserting on its state says what happened without depending on how a field is marked up.
 */
import {act, createElement} from "react"

import {useMcpConnectJourney} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {probeMcpUrl, createMcpEndpoint, listMcpTools} = vi.hoisted(() => ({
    probeMcpUrl: vi.fn(),
    createMcpEndpoint: vi.fn(),
    listMcpTools: vi.fn(),
}))

// The hook imports the api module directly, so the package barrel is the wrong seam: mocking
// it leaves the hook talking to the real client. Only the network is stubbed; the reducer and
// the hook are the code under test.
vi.mock("../../../agenta-entities/src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../agenta-entities/src/mcpEndpoint/api/api")>()),
    probeMcpUrl,
    createMcpEndpoint,
    listMcpTools,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
    useSetAtom: () => async () => undefined,
}))

type Journey = ReturnType<typeof useMcpConnectJourney>

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let journey: Journey

/** Mount the hook and keep the latest value in `journey`. */
const mountJourney = async () => {
    const Probe = () => {
        journey = useMcpConnectJourney({})
        return null
    }
    await act(async () => {
        root.render(createElement(Probe))
    })
}

/** Run an action and let the awaited work behind it settle. */
const run = async (action: () => void | Promise<unknown>) => {
    await act(async () => {
        await action()
    })
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })
}

/** URL, name, connect — the whole journey for a server that needs no authentication. */
const connectNoAuthServer = async () => {
    await mountJourney()
    await run(() => journey.setUrl("https://mcp.acme.test/"))
    await run(() => journey.submitUrl("https://mcp.acme.test/"))
    await run(() => journey.setName("Acme"))
    await run(() => journey.submitName())
    // `saving` is where the dialog calls finish(); do what it does.
    await run(() => journey.finish())
    await run(() => journey.loadTools())
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    probeMcpUrl.mockResolvedValue({
        count: 1,
        probe: {reachable: true, server_name: "Acme", auth: {mode: "none", scopes_offered: []}},
    })
    createMcpEndpoint.mockResolvedValue({
        count: 1,
        endpoint: {id: "mcp-1", slug: "acme-7mx", name: "Acme", auth_mode: "none"},
    })
    listMcpTools.mockResolvedValue([{name: "echo", description: "Echo it back"}])
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

describe("the journey up to a connection", () => {
    it("probes the URL and suggests the name the server gave", async () => {
        await mountJourney()
        await run(() => journey.setUrl("https://mcp.acme.test/"))
        await run(() => journey.submitUrl("https://mcp.acme.test/"))

        expect(probeMcpUrl).toHaveBeenCalledWith("https://mcp.acme.test/", "project-1")
        expect(journey.state.status).toBe("naming")
        expect(journey.state.name).toBe("Acme")
    })

    it("creates the connection without sending a slug, and keeps the one it is given", async () => {
        await mountJourney()
        await run(() => journey.setUrl("https://mcp.acme.test/"))
        await run(() => journey.submitUrl("https://mcp.acme.test/"))
        await run(() => journey.setName("Acme"))
        await run(() => journey.submitName())

        const [endpoint] = createMcpEndpoint.mock.calls[0]
        expect(endpoint).not.toHaveProperty("slug")
        expect(journey.state.slug).toBe("acme-7mx")
    })
})

describe("after a connection succeeds", () => {
    it("lists the connected server's tools", async () => {
        await connectNoAuthServer()

        expect(listMcpTools).toHaveBeenCalledWith("acme-7mx", "project-1")
        expect(journey.state.status).toBe("tools_ready")
        expect(journey.state.tools).toEqual([{name: "echo", description: "Echo it back"}])
    })

    it("reaches a state the dialog can be closed from", async () => {
        await connectNoAuthServer()

        // The whole cost of the finding: `discovering_tools` is busy, so a journey left there
        // disables both footer buttons for good.
        expect(journey.state.status).not.toBe("discovering_tools")
    })

    it("reports an empty list as empty, not as a failure", async () => {
        listMcpTools.mockResolvedValue([])

        await connectNoAuthServer()

        expect(journey.state.status).toBe("no_tools")
        expect(journey.state.error).toBeNull()
    })

    it("stays connected when the tool list cannot be read", async () => {
        listMcpTools.mockRejectedValue(new Error("The server did not answer."))

        await connectNoAuthServer()

        expect(journey.state.status).toBe("tools_failed")
        expect(journey.state.error).toBeTruthy()
        // Credentials are good; nothing here goes back to consent.
        expect(journey.state.endpointId).toBe("mcp-1")
    })

    it("reads the list again when asked, without connecting again", async () => {
        listMcpTools.mockRejectedValueOnce(new Error("The server did not answer."))

        await connectNoAuthServer()
        await run(() => journey.retryTools())
        await run(() => journey.loadTools())

        expect(listMcpTools).toHaveBeenCalledTimes(2)
        expect(createMcpEndpoint).toHaveBeenCalledTimes(1)
        expect(journey.state.status).toBe("tools_ready")
    })
})
