/**
 * Unit tests for the pure helpers in `useConnectFlow` — the connect-mode resolver (bug: a
 * toolkit with no Composio-managed OAuth, e.g. telegram, was always attempted as "oauth"
 * and 404'd), the mode-resolving guard (CodeRabbit finding on #5909: `resolveConnectMode`'s
 * "keep the hint while loading" fallback is fine for the RENDER, but a click landing in that
 * same window must not be allowed to fire a request with the raw, unverified hint), and the
 * error-message extractor (bug: a create failure settled the parked call silently, with no
 * error surfaced anywhere — see the ConnectToolWidget KNOWN_CONNECT_REASONS branch this
 * message feeds).
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {handleCreate, handleRefresh, queryToolConnections} = vi.hoisted(() => ({
    handleCreate: vi.fn(async () => ({connection: {}})),
    handleRefresh: vi.fn(async () => ({connection: {}})),
    queryToolConnections: vi.fn(async () => ({count: 0, connections: []})),
}))

vi.mock("@agenta/entities/gatewayTool", () => ({
    useToolIntegrationDetail: () => ({integration: {auth_schemes: ["oauth"]}, isLoading: false}),
    useToolsConnections: () => ({
        handleCreate,
        handleRefresh,
        invalidate: vi.fn(),
    }),
    queryToolConnections,
    isConnectionValid: (connection: {flags?: {is_valid?: boolean}} | null) =>
        connection?.flags?.is_valid === true,
}))

import {
    extractConnectErrorMessage,
    isConnectModeResolving,
    resolveConnectMode,
    useConnectFlow,
} from "../../src/clientTools/useConnectFlow"

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

/** A popup handle the flow can navigate, poll and close. */
const fakePopup = () => ({closed: false, location: {href: ""}, close: vi.fn()})

/** Mount the hook for one parked call and hand back its API. */
const mountFlow = async (settle: ReturnType<typeof vi.fn>, settled = false) => {
    const meta = {
        toolCallId: "connect-1",
        input: {integration: "github"},
        settled,
    } as Parameters<typeof useConnectFlow>[0]
    const host = document.createElement("div")
    const root = createRoot(host)
    let flow!: ReturnType<typeof useConnectFlow>
    const Probe = () => {
        flow = useConnectFlow(meta, settle)
        return null
    }
    await act(async () => {
        root.render(createElement(Probe))
    })
    return {
        get flow() {
            return flow
        },
        unmount: () => act(async () => root.unmount()),
    }
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    handleCreate.mockClear()
    handleRefresh.mockClear()
    queryToolConnections.mockReset()
    queryToolConnections.mockResolvedValue({count: 0, connections: []})
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("retry reuses the row the first attempt created", () => {
    const pending = {
        id: "conn-1",
        slug: "github",
        integration_key: "github",
        flags: {is_valid: false, is_active: true},
    }

    it("a pending row under the slug is refreshed, not created again (the 409 that broke Retry)", async () => {
        queryToolConnections.mockResolvedValue({count: 1, connections: [pending]})
        handleRefresh.mockResolvedValueOnce({
            connection: {...pending, data: {redirect_url: "https://composio.test/link"}},
        })
        const popup = fakePopup()
        vi.stubGlobal(
            "open",
            vi.fn(() => popup),
        )
        const settle = vi.fn().mockResolvedValue(undefined)
        const mounted = await mountFlow(settle)
        await act(async () => {
            await mounted.flow.runConnect(true)
        })
        expect(handleCreate).not.toHaveBeenCalled()
        expect(handleRefresh).toHaveBeenCalledWith("conn-1")
        expect(popup.location.href).toBe("https://composio.test/link")
        expect(mounted.flow.phase).toBe("connecting")
        await act(async () => {
            mounted.flow.cancel()
        })
        await mounted.unmount()
    })

    it("a row already authorized elsewhere settles as connected without a popup", async () => {
        queryToolConnections.mockResolvedValue({
            count: 1,
            connections: [{...pending, flags: {is_valid: true, is_active: true}}],
        })
        const popup = fakePopup()
        vi.stubGlobal(
            "open",
            vi.fn(() => popup),
        )
        const settle = vi.fn().mockResolvedValue(undefined)
        const mounted = await mountFlow(settle)
        await act(async () => {
            await mounted.flow.runConnect(true)
        })
        expect(handleCreate).not.toHaveBeenCalled()
        expect(handleRefresh).not.toHaveBeenCalled()
        expect(popup.close).toHaveBeenCalled()
        expect(settle).toHaveBeenCalledWith({
            output: {connected: true, integration: "github", slug: "github"},
        })
        await mounted.unmount()
    })

    it("no row yet: creates one as before", async () => {
        handleCreate.mockResolvedValueOnce({
            connection: {id: "conn-2", data: {redirect_url: "https://composio.test/new"}},
        })
        const popup = fakePopup()
        vi.stubGlobal(
            "open",
            vi.fn(() => popup),
        )
        const mounted = await mountFlow(vi.fn().mockResolvedValue(undefined))
        await act(async () => {
            await mounted.flow.runConnect(true)
        })
        expect(handleCreate).toHaveBeenCalledWith({slug: "github", name: "github", mode: "oauth"})
        expect(handleRefresh).not.toHaveBeenCalled()
        expect(popup.location.href).toBe("https://composio.test/new")
        await act(async () => {
            mounted.flow.cancel()
        })
        await mounted.unmount()
    })
})

describe("popup timing (iOS blocks window.open after an await)", () => {
    it("opens the window synchronously in the click, before any request resolves", async () => {
        // Hold the first request (the slug lookup) so nothing has resolved when we assert.
        let resolveLookup!: (value: {count: number; connections: never[]}) => void
        queryToolConnections.mockImplementationOnce(
            () => new Promise((resolve) => (resolveLookup = resolve)),
        )
        handleCreate.mockResolvedValueOnce({
            connection: {data: {redirect_url: "https://composio.test/link"}},
        })
        const popup = fakePopup()
        const open = vi.fn(() => popup)
        vi.stubGlobal("open", open)
        const mounted = await mountFlow(vi.fn().mockResolvedValue(undefined))
        let run!: Promise<void>
        act(() => {
            run = mounted.flow.runConnect(true)
        })
        expect(open).toHaveBeenCalledTimes(1)
        expect(open.mock.calls[0][0]).toBe("")
        await act(async () => {
            resolveLookup({count: 0, connections: []})
            await run
        })
        expect(popup.location.href).toBe("https://composio.test/link")
        await act(async () => {
            mounted.flow.cancel()
        })
        await mounted.unmount()
    })

    it("a blocked popup settles the parked call as a failure so the run resumes", async () => {
        handleCreate.mockResolvedValueOnce({
            connection: {data: {redirect_url: "https://composio.test/link"}},
        })
        vi.stubGlobal(
            "open",
            vi.fn(() => null),
        )
        const settle = vi.fn().mockResolvedValue(undefined)
        const mounted = await mountFlow(settle)
        await act(async () => {
            await mounted.flow.runConnect(true)
        })
        expect(settle).toHaveBeenCalledWith({
            output: {
                connected: false,
                integration: "github",
                slug: "github",
                reason: "Couldn’t open the connection window. Allow popups and retry.",
            },
        })
        expect(mounted.flow.outcome?.connected).toBe(false)
        await mounted.unmount()
    })

    it("closes the pre-opened window when the request fails, and surfaces the error", async () => {
        handleCreate.mockRejectedValueOnce({statusCode: 422, body: {detail: "nope"}})
        const popup = fakePopup()
        vi.stubGlobal(
            "open",
            vi.fn(() => popup),
        )
        const settle = vi.fn().mockResolvedValue(undefined)
        const mounted = await mountFlow(settle)
        await act(async () => {
            await mounted.flow.runConnect(true)
        })
        expect(popup.close).toHaveBeenCalled()
        expect(mounted.flow.outcome).toEqual({connected: false, reason: "nope"})
        await mounted.unmount()
    })

    it("closes the pre-opened window when there is no OAuth step", async () => {
        handleCreate.mockResolvedValueOnce({connection: {id: "conn-3", data: {}}})
        const popup = fakePopup()
        vi.stubGlobal(
            "open",
            vi.fn(() => popup),
        )
        const settle = vi.fn().mockResolvedValue(undefined)
        const mounted = await mountFlow(settle)
        await act(async () => {
            await mounted.flow.runConnect(true)
        })
        expect(popup.close).toHaveBeenCalled()
        expect(settle).toHaveBeenCalledWith({
            output: {connected: true, integration: "github", slug: "github"},
        })
        await mounted.unmount()
    })
})

describe("durable connection answer", () => {
    it("keeps a rejected parked answer retryable instead of reporting connected", async () => {
        const settle = vi
            .fn()
            .mockRejectedValueOnce(new Error("Answer was not saved"))
            .mockResolvedValue(undefined)
        const meta = {
            toolCallId: "connect-1",
            input: {integration: "github"},
            settled: false,
        } as Parameters<typeof useConnectFlow>[0]
        vi.stubGlobal(
            "open",
            vi.fn(() => fakePopup()),
        )
        const host = document.createElement("div")
        const root = createRoot(host)
        let flow!: ReturnType<typeof useConnectFlow>
        const Probe = () => {
            flow = useConnectFlow(meta, settle)
            return null
        }
        await act(async () => {
            root.render(createElement(Probe))
        })
        await act(async () => {
            await flow.runConnect(true)
        })
        expect(flow.errorText).toBe("Answer was not saved")
        expect(flow.outcome).toBeNull()
        expect(flow.phase).toBe("idle")
        await act(async () => {
            flow.decline()
            flow.cancel()
        })
        expect(settle).toHaveBeenCalledTimes(1)
        await act(async () => {
            await flow.runConnect(true)
        })
        expect(flow.outcome?.connected).toBe(true)
        expect(flow.errorText).toBeNull()
        expect(handleCreate).toHaveBeenCalledTimes(1)
        expect(settle).toHaveBeenCalledTimes(2)
        expect(settle).toHaveBeenLastCalledWith({
            output: {connected: true, integration: "github", slug: "github"},
        })
        await act(async () => {
            root.unmount()
        })
    })
})
