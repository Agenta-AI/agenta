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
        // Prefix, not equality: the button also carries its keycap, so its text is "Approve all⌘↵".
        const approveAll = [...host.querySelectorAll("button")].find((node) =>
            node.textContent?.startsWith("Approve all"),
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
        const deny = [...host.querySelectorAll("button")].find((node) =>
            node.textContent?.startsWith("Deny"),
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

    /** What Radix does: cancel the key in the capture phase, but let it keep propagating. */
    const pressCancelled = (init: KeyboardEventInit) =>
        act(() => {
            const event = new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                ...init,
            })
            window.addEventListener("keydown", (e) => e.preventDefault(), {
                capture: true,
                once: true,
            })
            window.dispatchEvent(event)
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

    // Radix handles Escape in the capture phase and calls preventDefault, but never
    // stopPropagation, so a dialog's Escape still reached this window listener and silently
    // denied the gate behind it. Cmd+Enter was never intercepted at all and silently approved it.
    it("answers nothing while a dialog owns the screen", () => {
        const responses: unknown[] = []
        const {cleanup} = mount({onRespond: () => responses.push(1)})

        const dialog = document.createElement("div")
        dialog.setAttribute("role", "dialog")
        dialog.setAttribute("data-state", "open")
        document.body.appendChild(dialog)

        press({key: "Escape"})
        press({key: "Enter", metaKey: true})
        expect(responses).toEqual([])

        // The same two keys answer the gate again the moment the dialog closes.
        dialog.remove()
        press({key: "Escape"})
        expect(responses).toEqual([1])

        cleanup()
    })

    // Radix never cancels Cmd+Enter, so only the overlay check can see the menu. Repro: park a
    // gate, open the top bar's settings menu, press Cmd+Enter. The gate was approved unseen.
    it("answers nothing while a menu owns the screen", () => {
        const responses: unknown[] = []
        const {cleanup} = mount({onRespond: () => responses.push(1)})

        const menu = document.createElement("div")
        menu.setAttribute("role", "menu")
        menu.setAttribute("data-state", "open")
        document.body.appendChild(menu)

        press({key: "Enter", metaKey: true})
        press({key: "Escape"})
        expect(responses).toEqual([])

        menu.remove()
        press({key: "Escape"})
        expect(responses).toEqual([1])

        cleanup()
    })

    // Every visited session stays mounted behind `display: none`. Two parallel runs both parking a
    // gate meant one Cmd+Enter answered the hidden one too.
    it("answers nothing while its own session is hidden", () => {
        const visible: unknown[] = []
        const hidden: unknown[] = []
        const mountInto = (parent: HTMLElement, sink: unknown[]) => {
            const holder = document.createElement("div")
            parent.appendChild(holder)
            const root = createRoot(holder)
            act(() => {
                root.render(
                    <ApprovalCard
                        approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
                        onRespond={() => sink.push(1)}
                        onApproveAll={() => undefined}
                    />,
                )
            })
            return () => act(() => root.unmount())
        }
        const shown = document.createElement("div")
        const offscreen = document.createElement("div")
        offscreen.style.display = "none"
        document.body.append(shown, offscreen)

        const cleanShown = mountInto(shown, visible)
        const cleanHidden = mountInto(offscreen, hidden)

        press({key: "Enter", metaKey: true})
        expect(visible).toEqual([1])
        expect(hidden).toEqual([])

        cleanShown()
        cleanHidden()
        shown.remove()
        offscreen.remove()
    })

    // antd sets no data-state and leaves its popups mounted, so the guard matches them by class.
    it.each([".ant-dropdown", ".ant-select-dropdown", ".ant-popover", ".ant-modal-wrap"])(
        "answers nothing while %s is open",
        (cls) => {
            const responses: unknown[] = []
            const {cleanup} = mount({onRespond: () => responses.push(1)})
            const popup = document.createElement("div")
            popup.className = cls.slice(1)
            document.body.appendChild(popup)

            press({key: "Enter", metaKey: true})
            press({key: "Escape"})
            expect(responses).toEqual([])

            popup.remove()
            press({key: "Escape"})
            expect(responses).toEqual([1])
            cleanup()
        },
    )

    // Radix cancels Escape in the capture phase and still lets it propagate. Repro: park a gate,
    // open any menu, press Escape. The menu closed AND the gate was denied.
    it("answers nothing when a menu already cancelled the key", () => {
        const responses: unknown[] = []
        const {cleanup} = mount({onRespond: () => responses.push(1)})

        pressCancelled({key: "Escape"})
        expect(responses).toEqual([])

        press({key: "Escape"})
        expect(responses).toEqual([1])

        cleanup()
    })
})
