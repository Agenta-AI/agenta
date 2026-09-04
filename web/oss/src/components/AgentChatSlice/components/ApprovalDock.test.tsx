/**
 * The dock's decision row.
 *
 * The batch peek is gone: a turn holding several gates answers as a whole, so "Approve all"
 * REPLACES Approve as the single primary, "Deny all" mirrors it, and the detail rows list the
 * pending actions — the informed-click job the popover used to do.
 */
import {act} from "react"

import {createRoot} from "react-dom/client"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// No hook mock: the card imports `useAlwaysAllowTool` by its relative path inside the package, so
// a `@agenta/chat/hooks` mock resolves elsewhere and does nothing. The always-allow row is covered
// where it can be mocked honestly — packages/agenta-chat/tests/unit/ApprovalCard.test.tsx.

const {default: ApprovalDock} = await import("./ApprovalDock")

const gate = (id: string, toolName: string, input: unknown) => ({
    approvalId: id,
    toolName,
    input,
})

const render = (approvals: unknown[]) =>
    renderToStaticMarkup(
        <ApprovalDock
            approvals={approvals as never}
            onApprovalResponse={() => undefined}
            entityId="rev-1"
        />,
    )

describe("one pending gate", () => {
    it("offers a plain Approve / Deny pair", () => {
        const markup = render([gate("a1", "bash", {command: "ls"})])

        expect(markup).toContain(">Approve<")
        expect(markup).toContain(">Deny<")
        expect(markup).not.toContain("Approve all")
    })
})

describe("several pending gates", () => {
    const batch = [
        gate("a1", "bash", {command: "ls"}),
        gate("a2", "webfetch", {url: "https://example.com"}),
    ]

    it("replaces the single-gate actions with batch ones", () => {
        const markup = render(batch)

        expect(markup).toContain("Approve all")
        expect(markup).toContain("Deny all")
        expect(markup).not.toContain(">Approve<")
    })

    it("lists every pending action, so Approve all is an informed click", () => {
        const markup = render(batch)

        expect(markup).toContain("See what runs (2)")
        expect(markup).toContain("Running a command")
        expect(markup).toContain("https://example.com")
    })
})

describe("no pending gate", () => {
    it("renders no card at all", () => {
        expect(render([])).not.toContain("Needs your approval")
    })
})

describe("interaction-scoped response state", () => {
    it("does not leak a late recoverable result onto the next desktop gate", async () => {
        let resolveFirst: ((value: {durable: boolean; recoverable: boolean}) => void) | undefined
        const onApprovalResponse = () =>
            new Promise<{durable: boolean; recoverable: boolean}>((resolve) => {
                resolveFirst = resolve
            })
        const host = document.createElement("div")
        document.body.appendChild(host)
        const root = createRoot(host)
        const renderGate = (id: string) => (
            <ApprovalDock
                approvals={[gate(id, "bash", {command: "ls"})]}
                onApprovalResponse={onApprovalResponse}
                entityId="rev-1"
            />
        )

        await act(async () => root.render(renderGate("g1")))
        const approveButton = [...host.querySelectorAll("button")].find((button) =>
            button.textContent?.includes("Approve"),
        ) as HTMLButtonElement
        await act(async () => {
            approveButton.click()
        })
        await act(async () => root.render(renderGate("g2")))
        await act(async () => resolveFirst?.({durable: true, recoverable: true}))

        expect(host.textContent).toContain("Needs your approval")
        expect(host.textContent).not.toContain("Answer saved, retry needed")

        await act(async () => root.unmount())
        host.remove()
    })
})
