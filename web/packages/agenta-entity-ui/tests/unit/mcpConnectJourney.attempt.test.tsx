/**
 * D34 and D40: who owns an attempt, and what the popup contract is.
 *
 * Every step of the consent path has a window between an await and the thing it installs. A
 * cancel or an unmount inside that window used to leave the work to arrive afterwards and
 * install itself anyway: a watch holding a listener, an interval and a three-minute timeout
 * on a dead attempt, or an endpoint row that the cancel had no way to find. OR67's teardown
 * cannot cover it, because at that moment there is nothing installed to tear down.
 *
 * The popup cases are the rest of D40. They are about the contract the watch depends on:
 * one window per attempt, opened by the caller, and the API's origin as the only one trusted
 * to say a consent finished.
 */
import {act, createElement} from "react"

import {useMcpConnectJourney} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {probeMcpUrl, createMcpEndpoint, deleteMcpEndpoint, beginMcpConnect, discoverMcpConnect} =
    vi.hoisted(() => ({
        probeMcpUrl: vi.fn(),
        createMcpEndpoint: vi.fn(),
        deleteMcpEndpoint: vi.fn(),
        beginMcpConnect: vi.fn(),
        discoverMcpConnect: vi.fn(),
    }))

vi.mock("../../../agenta-entities/src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../agenta-entities/src/mcpEndpoint/api/api")>()),
    probeMcpUrl,
    createMcpEndpoint,
    deleteMcpEndpoint,
    beginMcpConnect,
    discoverMcpConnect,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test/api"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
    useSetAtom: () => async () => undefined,
}))

type Journey = ReturnType<typeof useMcpConnectJourney>

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let journey: Journey

const mountJourney = async () => {
    const Probe = () => {
        journey = useMcpConnectJourney({})
        return null
    }
    await act(async () => {
        root.render(createElement(Probe))
    })
}

const settle = async () => {
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

/** A promise this test resolves by hand, so an await can be held open. */
const deferred = <T,>() => {
    let release!: (value: T) => void
    const promise = new Promise<T>((resolve) => {
        release = resolve
    })
    return {promise, release}
}

const fakePopup = () => ({closed: false, close: vi.fn(), location: {href: ""}}) as never

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    probeMcpUrl.mockResolvedValue({
        count: 1,
        probe: {reachable: true, server_name: "Acme", auth: {mode: "oauth", scopes_offered: []}},
    })
    createMcpEndpoint.mockResolvedValue({
        count: 1,
        endpoint: {id: "mcp-1", slug: "acme-7mx", name: "Acme", auth_mode: "oauth"},
    })
    deleteMcpEndpoint.mockResolvedValue(undefined)
    beginMcpConnect.mockResolvedValue({count: 1, redirect_url: "https://issuer.test/authorize"})
    discoverMcpConnect.mockResolvedValue({count: 1, scopes_offered: ["tools:list"]})
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

describe("cancelling while the connection is being created", () => {
    it("deletes the row that arrives afterwards", async () => {
        const create = deferred<unknown>()
        createMcpEndpoint.mockReturnValue(create.promise)

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        // Started, and still in flight.
        void journey.submitName()
        await settle()

        // The cancel has no row to delete: it does not exist yet.
        await act(async () => {
            await journey.cancel()
        })
        expect(deleteMcpEndpoint).not.toHaveBeenCalled()

        create.release({
            count: 1,
            endpoint: {id: "mcp-late", slug: "late", name: "Acme", auth_mode: "oauth"},
        })
        await settle()

        // Without the generation check this row stayed behind for good.
        expect(deleteMcpEndpoint).toHaveBeenCalledWith("mcp-late", "project-1")
    })
})

describe("cancelling while the authorization URL is being minted", () => {
    it("installs no watch, and closes the window it opened", async () => {
        const begin = deferred<unknown>()
        beginMcpConnect.mockReturnValue(begin.promise)
        const listeners = vi.spyOn(window, "addEventListener")
        const popup = fakePopup()

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        await act(async () => {
            await journey.submitName()
        })
        await settle()

        void journey.submitScopes(popup)
        await settle()
        await act(async () => {
            await journey.cancel()
        })

        begin.release({count: 1, redirect_url: "https://issuer.test/authorize"})
        await settle()

        // A watch installed here would hold a listener, an interval and a three-minute
        // timeout on an attempt nobody is waiting for.
        const messageListeners = listeners.mock.calls.filter(([type]) => type === "message")
        expect(messageListeners).toHaveLength(0)
        expect((popup as unknown as {close: ReturnType<typeof vi.fn>}).close).toHaveBeenCalled()
    })
})

describe("the popup contract", () => {
    it("gives each attempt its own window name", async () => {
        await mountJourney()
        const first = journey.popupName

        await act(async () => root.render(null))
        await mountJourney()

        // A shared name lets a second attempt reuse, and so hijack, the first one's window.
        expect(journey.popupName).not.toBe(first)
        expect(first).toMatch(/^mcp_oauth_/)
    })

    it("says up front whether this server will need a window at all", async () => {
        await mountJourney()
        expect(journey.expectsConsent).toBe(false)

        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })

        // The caller opens the window inside the tap, before any await, and only for a
        // server already known to use OAuth.
        expect(journey.expectsConsent).toBe(true)
    })

    it("falls back to this tab when the window was refused", async () => {
        const assign = vi.fn()
        vi.stubGlobal("location", {assign, href: "https://app.example.test/"})

        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        await act(async () => {
            await journey.submitName()
        })
        await settle()
        await act(async () => {
            await journey.submitScopes(null)
        })

        expect(assign).toHaveBeenCalledWith("https://issuer.test/authorize")
    })

    it("trusts only the origin that serves the callback", async () => {
        const listeners = vi.spyOn(window, "addEventListener")
        await mountJourney()
        await act(async () => journey.setUrl("https://mcp.acme.test/"))
        await act(async () => {
            await journey.submitUrl("https://mcp.acme.test/")
        })
        await act(async () => journey.setName("Acme"))
        await act(async () => {
            await journey.submitName()
        })
        await settle()
        await act(async () => {
            await journey.submitScopes(fakePopup())
        })

        // The watch is installed, which is what carries the trusted-origin set.
        expect(listeners.mock.calls.filter(([type]) => type === "message")).toHaveLength(1)

        // A completion from anywhere but the API's own origin is ignored.
        const handler = listeners.mock.calls.find(([type]) => type === "message")?.[1] as (
            event: MessageEvent,
        ) => void
        await act(async () => {
            handler({
                data: {type: "mcp:oauth:connected", success: true, endpoint_id: "mcp-1"},
                origin: "https://evil.test",
            } as MessageEvent)
        })
        expect(journey.state.status).toBe("awaiting_consent")

        await act(async () => {
            handler({
                data: {type: "mcp:oauth:connected", success: true, endpoint_id: "mcp-1"},
                origin: "https://api.example.test",
            } as MessageEvent)
        })
        expect(journey.state.status).toBe("saving")
    })
})
