/**
 * The card's auto-approve row, which exists only when the grant would actually do something.
 *
 * Worth its own test because the rule is invisible from the outside: a `commit_revision` gate never
 * shows the row (platform ops are never grantable), so a card missing it looks like a bug until you
 * know the tool class decides. The mock targets the RELATIVE module the card imports — mocking the
 * `@agenta/chat/hooks` barrel resolves to a different file and silently does nothing.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {beforeEach, describe, expect, it, vi} from "vitest"

const grantState = vi.hoisted(() => ({eligible: false, alreadyAllowed: false}))
// Records what a decision actually granted, so the batch case can assert every tool landed.
const granted = vi.hoisted(() => ({calls: [] as string[][]}))

vi.mock("../../src/hooks/useAlwaysAllowTool", () => ({
    useAlwaysAllowTool: () => ({
        infoFor: () => grantState,
        grantMany: (toolNames: string[]) => {
            granted.calls.push(toolNames)
            return toolNames
        },
    }),
}))

const {ApprovalCard} = await import("../../src/components/ApprovalCard")
const {createRoot} = await import("react-dom/client")
const {act} = await import("react")

beforeEach(() => {
    grantState.eligible = false
    grantState.alreadyAllowed = false
    granted.calls = []
})

const render = () =>
    renderToStaticMarkup(
        <ApprovalCard
            approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
            entityId="rev-1"
            onRespond={() => undefined}
            onApproveAll={() => undefined}
        />,
    )

describe("the auto-approve row", () => {
    it("appears for a tool whose permission can actually be granted", () => {
        grantState.eligible = true
        expect(render()).toContain("Always auto-approve")
    })

    it("stays hidden for an ineligible gate (platform ops like commit_revision)", () => {
        expect(render()).not.toContain("Always auto-approve")
    })

    it("stays hidden once the tool is already allowed — the row would be a no-op", () => {
        grantState.eligible = true
        grantState.alreadyAllowed = true
        expect(render()).not.toContain("Always auto-approve")
    })

    // The label forwards a click on the wording to the nested Radix <button>. Pinned because a
    // hand-rolled onClick here reads like the missing piece and silently double-toggles.
    it("toggles once when the wording next to the box is clicked", () => {
        grantState.eligible = true
        const host = document.createElement("div")
        document.body.appendChild(host)
        const root = createRoot(host)
        act(() => {
            root.render(
                <ApprovalCard
                    approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
                    entityId="rev-1"
                    onRespond={() => undefined}
                    onApproveAll={() => undefined}
                />,
            )
        })

        const box = host.querySelector('[role="checkbox"]')!
        const wording = [...host.querySelectorAll("span")].find(
            (node) => node.textContent === "Always auto-approve",
        )!
        expect(box.getAttribute("data-state")).toBe("unchecked")

        act(() => {
            wording.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        expect(box.getAttribute("data-state")).toBe("checked")

        act(() => {
            wording.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        expect(box.getAttribute("data-state")).toBe("unchecked")

        act(() => {
            root.unmount()
            host.remove()
        })
    })
})

describe("granting a batch", () => {
    const mount = (approvals: {approvalId: string; toolName: string; input: unknown}[]) => {
        const host = document.createElement("div")
        document.body.appendChild(host)
        const root = createRoot(host)
        act(() => {
            root.render(
                <ApprovalCard
                    approvals={approvals}
                    entityId="rev-1"
                    onRespond={() => undefined}
                    onApproveAll={() => undefined}
                />,
            )
        })
        return {host, cleanup: () => act(() => root.unmount())}
    }

    // "Approve all" answers every gate, so the grant has to cover every tool it just approved. It
    // used to grant only approvals[0], leaving the rest to stop the next run.
    it("grants every tool the decision approves, not just the first gate's", () => {
        grantState.eligible = true
        const {host, cleanup} = mount([
            {approvalId: "a1", toolName: "bash", input: {command: "ls"}},
            {approvalId: "a2", toolName: "Write", input: {path: "/tmp/x"}},
            {approvalId: "a3", toolName: "bash", input: {command: "pwd"}},
        ])

        const box = host.querySelector('[role="checkbox"]')!
        act(() => {
            box.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        const approveAll = [...host.querySelectorAll("button")].find(
            (node) => node.textContent === "Approve all",
        )!
        act(() => {
            approveAll.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        expect(granted.calls).toEqual([["bash", "Write"]])
        cleanup()
    })

    it("grants nothing on a denial", () => {
        grantState.eligible = true
        const {host, cleanup} = mount([
            {approvalId: "a1", toolName: "bash", input: {command: "ls"}},
        ])

        const box = host.querySelector('[role="checkbox"]')!
        act(() => {
            box.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        const deny = [...host.querySelectorAll("button")].find(
            (node) => node.textContent === "Deny",
        )!
        act(() => {
            deny.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        expect(granted.calls).toEqual([])
        cleanup()
    })
})

describe("keyboard shortcuts", () => {
    // renderToStaticMarkup can't fire events, so mount into jsdom via the client renderer.
    const mount = (props: Record<string, unknown>) => {
        const host = document.createElement("div")
        document.body.appendChild(host)
        const root = createRoot(host)
        act(() => {
            root.render(
                <ApprovalCard
                    approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
                    onRespond={() => undefined}
                    onApproveAll={() => undefined}
                    {...props}
                />,
            )
        })
        return {
            host,
            cleanup: () =>
                act(() => {
                    root.unmount()
                    host.remove()
                }),
        }
    }

    const press = (init: KeyboardEventInit) =>
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, ...init}))
        })

    it("approves on Cmd/Ctrl+Enter and denies on Escape", () => {
        const responses: {approved: boolean}[] = []
        const {cleanup} = mount({
            onRespond: ({approved}: {approved: boolean}) => responses.push({approved}),
        })

        press({key: "Enter", ctrlKey: true})
        expect(responses).toEqual([{approved: true}])

        cleanup()
        responses.length = 0
        const second = mount({
            onRespond: ({approved}: {approved: boolean}) => responses.push({approved}),
        })
        press({key: "Escape"})
        expect(responses).toEqual([{approved: false}])
        second.cleanup()
    })

    it("ignores a bare Enter (it belongs to the composer) and a plain modifier", () => {
        const responses: unknown[] = []
        const {cleanup} = mount({onRespond: () => responses.push(1)})

        press({key: "Enter"})
        press({key: "a", ctrlKey: true})
        expect(responses).toEqual([])
        cleanup()
    })

    it("fires nothing once a decision is settling", () => {
        const responses: unknown[] = []
        const {cleanup} = mount({responding: true, onRespond: () => responses.push(1)})

        press({key: "Enter", metaKey: true})
        press({key: "Escape"})
        expect(responses).toEqual([])
        cleanup()
    })
})
