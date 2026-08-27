/**
 * The dock's decision row.
 *
 * The batch peek is gone: a turn holding several gates answers as a whole, so "Approve all"
 * REPLACES Approve as the single primary, "Deny all" mirrors it, and the detail rows list the
 * pending actions — the informed-click job the popover used to do.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

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
