/**
 * CR12: what closing the shared tool catalog is allowed to tell the agent.
 *
 * The catalog drawer is not this tool call's drawer. It is the same surface settings opens,
 * shared through one atom, and it closes on a connection, on a back-out, and on an Escape
 * key alike. Reading its close as success told the agent a server was connected whenever the
 * person looked at the catalog and left, and the agent then went on to call a tool that is
 * still refused. Every case here holds the drawer's close fixed and varies only what the
 * connections list says afterwards.
 */
import {act, createElement} from "react"

import {atom} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {queryToolConnections} = vi.hoisted(() => ({queryToolConnections: vi.fn()}))

const catalogOpenAtom = atom(false)
const endpointsAtom = atom({data: [] as unknown[]})

vi.mock("@agenta/entities/gatewayTool", () => ({
    toolCatalogDrawerOpenAtom: catalogOpenAtom,
    queryToolConnections,
    isConnectionActive: (connection: {flags?: Record<string, unknown>} | null | undefined) =>
        connection?.flags?.is_active === true,
    isConnectionValid: (connection: {flags?: Record<string, unknown>} | null | undefined) =>
        connection?.flags?.is_valid === true,
}))

vi.mock("@agenta/entities/mcpEndpoint", () => ({mcpEndpointsQueryAtom: endpointsAtom}))

const {useGatewayConnectFlow} = await import("./useGatewayConnectFlow")

type Flow = ReturnType<typeof useGatewayConnectFlow>

const target = {plane: "mcp" as const, name: "acme-notion"}

const connection = (flags: Record<string, boolean>) => ({id: "conn-1", flags})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let flow: Flow
let settle: ReturnType<typeof vi.fn>

const mount = async () => {
    const Probe = () => {
        flow = useGatewayConnectFlow(target, {settled: false} as never, settle)
        return null
    }
    await act(async () => {
        root.render(createElement(Probe))
    })
}

const drain = async () => {
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

/** Open the catalog through the widget, then close it the way the drawer itself does. */
const openAndCloseCatalog = async () => {
    await act(async () => {
        flow.runConnect()
    })
    await act(async () => {
        const {getDefaultStore} = await import("jotai")
        getDefaultStore().set(catalogOpenAtom, false)
    })
    await drain()
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    settle = vi.fn()
    queryToolConnections.mockResolvedValue({count: 0, connections: []})
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    const {getDefaultStore} = await import("jotai")
    getDefaultStore().set(catalogOpenAtom, false)
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("closing the shared catalog drawer", () => {
    it("reports not connected when nothing in the catalog was connected", async () => {
        await mount()
        await openAndCloseCatalog()

        expect(settle).toHaveBeenCalledTimes(1)
        expect(settle.mock.calls[0][0].output).toEqual({
            connected: false,
            target,
            reason: "cancelled",
        })
    })

    it("reports connected once the target's own connection is live", async () => {
        queryToolConnections.mockResolvedValue({
            count: 1,
            connections: [connection({is_active: true, is_valid: true})],
        })
        await mount()
        await openAndCloseCatalog()

        expect(settle).toHaveBeenCalledTimes(1)
        expect(settle.mock.calls[0][0].output).toEqual({connected: true, target})
    })

    it("asks about this target, not about the catalog as a whole", async () => {
        await mount()
        await openAndCloseCatalog()

        expect(queryToolConnections).toHaveBeenCalledWith({integration_key: "acme-notion"})
    })

    it("reports not connected when the connection exists but is no longer valid", async () => {
        queryToolConnections.mockResolvedValue({
            count: 1,
            connections: [connection({is_active: true, is_valid: false})],
        })
        await mount()
        await openAndCloseCatalog()

        expect(settle.mock.calls[0][0].output).toMatchObject({connected: false})
    })

    it("says unverified, not cancelled, when the connections list cannot be read", async () => {
        queryToolConnections.mockRejectedValue(new Error("network down"))
        await mount()
        await openAndCloseCatalog()

        expect(settle).toHaveBeenCalledTimes(1)
        expect(settle.mock.calls[0][0].output).toEqual({
            connected: false,
            target,
            reason: "unverified",
        })
    })

    it("settles nothing while the drawer is still open", async () => {
        await mount()
        await act(async () => {
            flow.runConnect()
        })
        await drain()

        expect(settle).not.toHaveBeenCalled()
        expect(queryToolConnections).not.toHaveBeenCalled()
    })
})
