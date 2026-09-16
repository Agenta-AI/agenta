/**
 * The connect dialog used to be mounted by the config row's `extra` slot. The row is clickable and
 * `extra` renders inside that click target, and React events propagate through the React tree
 * rather than the DOM tree — so every click inside the portalled dialog reopened the edit drawer,
 * which then surfaced over the chat when the consent popup closed.
 *
 * The first two cases establish that mechanism against a hand-built row, so the ones after
 * them — that the add-server drawer reports the request instead of mounting the journey —
 * are not vacuous assertions about a component that happens to render nothing.
 *
 * The rows changed shape in the gateway redesign; the reason this file exists did not. A
 * clickable row is still a click target that a portal does not escape.
 */
import {act, createElement, type ReactNode} from "react"

import {createPortal} from "react-dom"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    McpAddServerDrawer,
    type McpConnectionOption,
} from "../../src/mcpEndpoint/McpAddServerDrawer"

const OPTIONS: McpConnectionOption[] = [
    {slug: "acme", name: "Acme", host: "mcp.example.test", status: "connected"},
    {slug: "octolens", name: "Octolens", host: "mcp.octolens.com", status: "login_expired"},
]

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

describe("McpAddServerDrawer", () => {
    it("reports the connect request rather than mounting the journey itself", async () => {
        const onEdit = vi.fn()
        const onReconnect = vi.fn()
        await render(
            createElement(
                "div",
                null,
                createElement(Row, {onEdit}),
                // Mounted as a SIBLING of the rows, which is how AgentTemplateControl
                // mounts it. Inside a row it would misbehave for the reason above, and the
                // drawer cannot defend itself against that: its own portal does not escape
                // the React tree, so only the host's placement can.
                createElement(McpAddServerDrawer, {
                    open: true,
                    onClose: () => undefined,
                    options: OPTIONS,
                    onAdd: () => undefined,
                    onConnectServer: () => undefined,
                    onReconnect,
                }),
            ),
        )

        const reconnect = [...document.querySelectorAll("button")].find(
            (button) => button.getAttribute("aria-label") === "Reconnect Octolens",
        )
        await act(async () => {
            reconnect!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        expect(onReconnect).toHaveBeenCalledWith(OPTIONS[1])
        expect(onEdit).not.toHaveBeenCalled()
    })

    it("renders no connect journey of its own, so nothing it mounts can reach a row", async () => {
        await render(
            createElement(McpAddServerDrawer, {
                open: true,
                onClose: () => undefined,
                options: OPTIONS,
                onAdd: () => undefined,
                onConnectServer: () => undefined,
                onReconnect: () => undefined,
            }),
        )

        // Copy from the journey's own screens, which would be on the page if it were here.
        expect(document.body.textContent).not.toContain("Choose which permissions to grant.")
        expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1)
    })
})
