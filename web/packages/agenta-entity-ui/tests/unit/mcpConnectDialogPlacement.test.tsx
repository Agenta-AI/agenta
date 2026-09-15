/**
 * The connect dialog used to be mounted by the config row's `extra` slot. The row is clickable and
 * `extra` renders inside that click target, and React events propagate through the React tree
 * rather than the DOM tree — so every click inside the portalled dialog reopened the edit drawer,
 * which then surfaced over the chat when the consent popup closed.
 *
 * The first two cases establish that mechanism against a hand-built row, so the third — that
 * McpServerConnectAction reports the request instead of mounting the dialog — is not a vacuous
 * assertion about a component that happens to render nothing.
 */
import {act, createElement, type ReactNode} from "react"

import {createPortal} from "react-dom"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const endpoint = {
    id: "mcp-1",
    slug: "acme",
    name: "Acme",
    auth_mode: "oauth" as const,
    namespace: "custom" as const,
    data: {route: {base_url: "https://mcp.example.test"}},
}

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    mcpEndpointsQueryAtom: {},
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => ({data: [endpoint]}),
}))

import {McpServerConnectAction} from "../../src/mcpEndpoint/McpServerConnectAction"

/** The clickable config row, reduced to the one property that caused the defect. */
const Row = ({onEdit, children}: {onEdit: () => void; children?: ReactNode}) =>
    createElement("div", {onClick: onEdit, "data-testid": "row"}, children)

/** A stand-in for the dialog: portalled out of the DOM subtree, exactly as EnhancedModal is. */
const PortalDialog = () =>
    createPortal(
        createElement("button", {type: "button", "data-testid": "dialog-confirm"}, "Connect"),
        document.body,
    )

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (node: ReactNode) => {
    await act(async () => {
        root.render(node)
    })
}

const click = async (testId: string) => {
    const element = document.querySelector(`[data-testid="${testId}"]`)
    expect(element, `no element with data-testid="${testId}"`).not.toBeNull()
    await act(async () => {
        element!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
})

describe("where the MCP connect dialog is mounted", () => {
    it("reaches the row's onClick when the dialog is a child of the row, portal and all", async () => {
        const onEdit = vi.fn()
        await render(createElement(Row, {onEdit}, createElement(PortalDialog)))

        await click("dialog-confirm")

        expect(onEdit).toHaveBeenCalledOnce()
    })

    it("leaves the row alone when the dialog is mounted as a sibling", async () => {
        const onEdit = vi.fn()
        await render(
            createElement("div", null, createElement(Row, {onEdit}), createElement(PortalDialog)),
        )

        await click("dialog-confirm")

        expect(onEdit).not.toHaveBeenCalled()
    })
})

describe("McpServerConnectAction", () => {
    it("asks its host to authorize the endpoint instead of mounting a dialog", async () => {
        const onEdit = vi.fn()
        const onConnect = vi.fn()
        await render(
            createElement(
                Row,
                {onEdit},
                createElement(McpServerConnectAction, {slug: "acme", onConnect}),
            ),
        )

        // The trigger is the row's own child, so the guard on it still has to hold.
        await click("row")
        onEdit.mockClear()

        const connectButton = [...document.querySelectorAll("button")].find(
            (button) => button.textContent === "Connect",
        )
        await act(async () => {
            connectButton!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        expect(onConnect).toHaveBeenCalledWith(endpoint)
        expect(onEdit).not.toHaveBeenCalled()
    })

    it("renders no dialog of its own, so nothing it mounts can reach the row", async () => {
        await render(
            createElement(McpServerConnectAction, {slug: "acme", onConnect: () => undefined}),
        )

        expect(host.querySelector("[role='dialog']")).toBeNull()
        expect(document.body.textContent).not.toContain("Choose which permissions to grant.")
    })
})
