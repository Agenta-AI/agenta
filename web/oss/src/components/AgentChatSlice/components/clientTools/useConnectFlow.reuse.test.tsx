/**
 * Issue #5911: the agent asked to connect a provider the project had already connected, and the
 * flow offered Connect anyway — nothing ever looked at what the project holds.
 *
 * Two behaviours are pinned here. A still-parked call settles against an existing usable
 * connection without attempting a create, and only on the ACTIVE instance — the dock and the
 * inline marker both mount this hook for the same call, so an automatic settle on both would be
 * the double-`addToolOutput` the module contract forbids. And a call that settled as a false
 * failure (the OAuth callback lands server-side even when the popup never posts back) stops
 * reading as failed, without repainting cards rehydrated from an older transcript.
 */
import {act} from "react"

import type {ClientToolMeta, SettleClientTool} from "@agenta/chat/skin"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useConnectFlow} from "./useConnectFlow"

const handleCreate = vi.fn()
const connectionsRef = {current: [] as {slug: string; flags: Record<string, boolean>}[]}

// `vi.mock` is hoisted above the imports; the factories read the refs above only when called.
vi.mock("@agenta/entities/gatewayTool", () => ({
    useToolIntegrationDetail: () => ({integration: {auth_schemes: ["api_key"]}, isLoading: false}),
    useToolIntegrationConnections: () => ({connections: connectionsRef.current, isLoading: false}),
    isConnectionActive: (c: {flags?: Record<string, boolean>}) => !!c.flags?.is_active,
    isConnectionValid: (c: {flags?: Record<string, boolean>}) => !!c.flags?.is_valid,
}))

vi.mock("@agenta/settings-ui", () => ({
    useToolsConnections: () => ({handleCreate, invalidate: vi.fn()}),
}))

vi.mock("@/oss/lib/helpers/api", () => ({
    getAgentaApiUrl: () => "https://api.example.test",
}))

const READY = {slug: "telegram-main", flags: {is_active: true, is_valid: true}}
const STRANDED = {slug: "telegram-main", flags: {is_active: true, is_valid: false}}

const meta = (over: Partial<ClientToolMeta> = {}): ClientToolMeta =>
    ({
        toolCallId: "call-1",
        toolName: "request_connection",
        renderKind: "connect",
        state: "input-available",
        // The slug the ladder handed the agent — NOT the one the project actually holds.
        input: {integration: "telegram", slug: "telegram-main-2", mode: "api_key"},
        output: undefined,
        settled: false,
        part: {},
        ...over,
    }) as ClientToolMeta

let container: HTMLDivElement
let root: Root
let latest: ReturnType<typeof useConnectFlow>

const Harness = ({
    meta: m,
    settle,
    active,
}: {
    meta: ClientToolMeta
    settle: SettleClientTool
    active: boolean
}) => {
    latest = useConnectFlow(m, settle, active)
    return null
}

const render = async (m: ClientToolMeta, settle: SettleClientTool, active = true) => {
    await act(async () => {
        root.render(<Harness meta={m} settle={settle} active={active} />)
    })
}

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    connectionsRef.current = []
})

afterEach(async () => {
    await act(async () => {
        root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
})

describe("useConnectFlow — reuse the project's existing connection", () => {
    it("settles a parked call against the existing row, and never calls create", async () => {
        connectionsRef.current = [READY]
        const settle = vi.fn()
        await render(meta(), settle)

        expect(handleCreate).not.toHaveBeenCalled()
        expect(settle).toHaveBeenCalledTimes(1)
        // The EXISTING slug, not the `-2` the agent was handed: that reference is what the
        // runner re-resolves on the next turn.
        expect(settle.mock.calls[0][0]).toMatchObject({
            output: {connected: true, integration: "telegram", slug: "telegram-main"},
        })
    })

    it("stays silent on the inactive instance, so the two mounted flows can't both settle", async () => {
        connectionsRef.current = [READY]
        const settle = vi.fn()
        await render(meta(), settle, false)

        expect(settle).not.toHaveBeenCalled()
    })

    it("still needs a real connect when the only row is stranded mid-handshake", async () => {
        connectionsRef.current = [STRANDED]
        const settle = vi.fn()
        await render(meta(), settle)

        expect(settle).not.toHaveBeenCalled()
    })

    it("leaves a runner-deferred sibling alone — it arrives already settled and the agent re-asks", async () => {
        connectionsRef.current = [READY]
        const settle = vi.fn()
        await render(meta({state: "output-error", settled: true}), settle)

        expect(settle).not.toHaveBeenCalled()
    })

    it("waits for a complete input — a partial `input-streaming` call has no integration yet", async () => {
        connectionsRef.current = [READY]
        const settle = vi.fn()
        await render(meta({state: "input-streaming"}), settle)

        expect(settle).not.toHaveBeenCalled()
    })
})

describe("useConnectFlow — a connection that actually succeeded stops reading as failed", () => {
    it("corrects the chip once the requery finds the connection the popup never reported", async () => {
        // The inline marker: parked, nothing usable yet.
        connectionsRef.current = [STRANDED]
        const settle = vi.fn()
        await render(meta(), settle, false)
        expect(latest.manuallyConnected).toBe(false)

        // The dock settles it as a timeout, and the callback turns out to have landed anyway.
        connectionsRef.current = [READY]
        await render(meta({settled: true, output: {reason: "timeout"}}), settle, false)

        expect(latest.manuallyConnected).toBe(true)
    })

    it("leaves an explicit 'Not now' standing — a decision, not a mishap", async () => {
        connectionsRef.current = [STRANDED]
        const settle = vi.fn()
        await render(meta(), settle, false)

        connectionsRef.current = [READY]
        await render(meta({settled: true, output: {reason: "declined"}}), settle, false)

        expect(latest.manuallyConnected).toBe(false)
    })

    it("leaves a card rehydrated from the transcript alone — that attempt's result is history", async () => {
        connectionsRef.current = [READY]
        const settle = vi.fn()
        await render(meta({settled: true, output: {reason: "timeout"}}), settle, false)

        expect(latest.manuallyConnected).toBe(false)
    })
})
