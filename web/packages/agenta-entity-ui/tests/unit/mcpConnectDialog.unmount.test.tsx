/**
 * OR67: closing the connect dialog while the authorization popup was still open left a `message`
 * listener and a polling interval behind, and every reopen added another pair. The agent config
 * row unmounts this dialog on close, so the teardown has to hang off unmount rather than off the
 * callback that started the watch. That wiring is what this asserts.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {beginMcpConnect, discoverMcpConnect} = vi.hoisted(() => ({
    beginMcpConnect: vi.fn(async () => ({count: 1, redirect_url: "https://issuer.test/authorize"})),
    discoverMcpConnect: vi.fn(async () => ({count: 1, scopes_offered: []})),
}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    // The watch and the trust check are the code under test, so only the network calls are stubbed.
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    beginMcpConnect,
    discoverMcpConnect,
}))

vi.mock("@agenta/shared/api", () => ({
    getAgentaApiUrl: () => "https://api.example.test",
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
}))

vi.mock("@agenta/ui", () => ({
    EnhancedModal: ({children}: {children?: unknown}) => children,
    ModalContent: ({children}: {children?: unknown}) => children,
    // The footer is the only control this test drives, so it is reduced to its confirm handler.
    ModalFooter: ({onConfirm}: {onConfirm: () => void}) => {
        confirmHandler = onConfirm
        return null
    },
    message: {warning: vi.fn(), error: vi.fn()},
}))

vi.mock("@agenta/ui/ui", () => ({Checkbox: () => null}))

import McpConnectDialog from "../../src/mcpEndpoint/McpConnectDialog"

let confirmHandler: (() => void) | null = null

const endpoint = {
    id: "mcp-1",
    slug: "acme",
    name: "Acme",
    auth_mode: "oauth" as const,
    namespace: "custom" as const,
    data: {route: {base_url: "https://mcp.example.test"}},
}

/** Counts only the listeners this dialog is responsible for. */
const messageListeners = () => ({
    added: addSpy.mock.calls.filter(([type]) => type === "message").length,
    removed: removeSpy.mock.calls.filter(([type]) => type === "message").length,
})

let addSpy: ReturnType<typeof vi.spyOn>
let removeSpy: ReturnType<typeof vi.spyOn>
let intervalSpy: ReturnType<typeof vi.spyOn>
let clearIntervalSpy: ReturnType<typeof vi.spyOn>
let popup: {closed: boolean}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    confirmHandler = null
    popup = {closed: false}
    vi.stubGlobal(
        "open",
        vi.fn(() => popup),
    )
    addSpy = vi.spyOn(window, "addEventListener")
    removeSpy = vi.spyOn(window, "removeEventListener")
    intervalSpy = vi.spyOn(globalThis, "setInterval")
    clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

/** Mount the dialog, start a connect, and hand back the popup and the unmount. */
const mountAndConnect = async () => {
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () => {
        root.render(createElement(McpConnectDialog, {endpoint, onClose: () => undefined}))
    })
    await act(async () => {
        confirmHandler?.()
    })
    return {unmount: () => act(async () => root.unmount())}
}

describe("McpConnectDialog consent watch", () => {
    it("attaches a listener and a poll once the authorization popup opens", async () => {
        await mountAndConnect()

        expect(messageListeners().added).toBe(1)
        expect(intervalSpy).toHaveBeenCalledTimes(1)
    })

    it("releases both when the dialog unmounts with the popup still open", async () => {
        const dialog = await mountAndConnect()

        await dialog.unmount()

        expect(popup.closed).toBe(false)
        expect(messageListeners().removed).toBe(messageListeners().added)
        expect(clearIntervalSpy).toHaveBeenCalled()
    })

    it("leaves nothing behind across repeated open, connect and close cycles", async () => {
        for (let i = 0; i < 3; i++) {
            const dialog = await mountAndConnect()
            await dialog.unmount()
        }

        const {added, removed} = messageListeners()
        expect(added).toBe(3)
        expect(removed).toBe(added)
    })

    it("opens a differently named popup per dialog, so a second attempt cannot reuse the first", async () => {
        await mountAndConnect()
        await mountAndConnect()

        const names = (window.open as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
            ([, name]) => name,
        )
        expect(names).toHaveLength(2)
        expect(names[0]).not.toBe(names[1])
    })
})
