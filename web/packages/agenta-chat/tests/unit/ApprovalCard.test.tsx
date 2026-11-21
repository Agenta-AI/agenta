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

import editAgentConfigTurn from "./fixtures/editAgentConfigTurn.json"

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

// The agent's latest version, as the latest-revision query would answer it.
const versions = vi.hoisted(() => ({latest: undefined as number | undefined}))
vi.mock("../../src/hooks/useChangeVersions", () => ({
    useChangeVersions: (base?: {version?: number}) => ({
        baseVersion: base?.version,
        latestVersion: versions.latest,
    }),
}))

const {ApprovalCard} = await import("../../src/components/ApprovalCard")
const {createRoot} = await import("react-dom/client")
const {act} = await import("react")

beforeEach(() => {
    versions.latest = undefined
    grantState.eligible = false
    grantState.alreadyAllowed = false
    granted.calls = []
})

const render = ({alwaysAllowOffered}: {alwaysAllowOffered?: boolean} = {}) =>
    renderToStaticMarkup(
        <ApprovalCard
            approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
            entityId="rev-1"
            alwaysAllowOffered={alwaysAllowOffered}
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

    // A builder chat: the grant would go to the builder itself, not to the agent it edits.
    it("stays hidden when the host does not offer it", () => {
        grantState.eligible = true
        expect(render({alwaysAllowOffered: false})).not.toContain("Always auto-approve")
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

describe("durable response state", () => {
    it("shows that the answer was accepted while the continuation catches up", () => {
        const markup = renderToStaticMarkup(
            <ApprovalCard
                approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
                responding
                answered
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )

        // The card shrinks to its result row (task 26.1): no buttons while the result comes.
        expect(markup).toContain("Waiting for the agent")
        expect(markup).toContain("Your answer is saved.")
        expect(markup).not.toContain("Approve")
        expect(markup).not.toContain("Deny")
    })

    it("keeps a failed answer pending and surfaces the retryable error", () => {
        const markup = renderToStaticMarkup(
            <ApprovalCard
                approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
                errorText="Approval failed. Please try again."
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )

        expect(markup).toContain("Needs your approval")
        expect(markup).toContain("Approval failed. Please try again.")
        expect(markup).toContain(">Approve<")
    })

    it("explains a recoverable 202 on the shared desktop and mobile card", () => {
        const markup = renderToStaticMarkup(
            <ApprovalCard
                approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
                answered
                recoverable
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )

        expect(markup).toContain("Answer saved, retry needed")
        expect(markup).toContain("Send your next message to retry the continuation")
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

    // Two conversations on one screen (the session and the builder chat) can each show a card.
    it("answers only when the host says the keys belong to this card", () => {
        const responses: unknown[] = []
        let owns = false
        const cards: HTMLElement[] = []
        const {cleanup} = mount({
            onRespond: () => responses.push(1),
            ownsShortcut: (card: HTMLElement) => {
                cards.push(card)
                return owns
            },
        })

        press({key: "Enter", metaKey: true})
        press({key: "Escape"})
        expect(responses).toEqual([])
        expect(cards[0]?.isConnected).toBe(true)

        owns = true
        press({key: "Enter", metaKey: true})
        expect(responses).toEqual([1])
        cleanup()
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

describe("the read-only card (a person who can view but not send)", () => {
    const renderReadOnly = () =>
        renderToStaticMarkup(
            <ApprovalCard
                approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
                entityId="rev-1"
                steerEnabled
                readOnly
                readOnlyNote="Waiting for Alice Martin or someone who can send in this chat."
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )

    it("readOnly renders no answer buttons", () => {
        grantState.eligible = true
        const html = renderReadOnly()
        expect(html).not.toContain("Approve")
        expect(html).not.toContain("Deny")
        expect(html).not.toContain("Redirect")
        expect(html).not.toContain("Always auto-approve")
    })

    it("keeps the eyebrow and shows who it waits for", () => {
        const html = renderReadOnly()
        expect(html).toContain("Needs your approval")
        expect(html).toContain("Only the owner can approve")
        expect(html).toContain("Waiting for Alice Martin or someone who can send in this chat.")
    })

    it("says the reader can read the chat when the host names nobody", () => {
        const html = renderToStaticMarkup(
            <ApprovalCard
                approvals={[{approvalId: "a1", toolName: "bash", input: {command: "ls"}}]}
                readOnly
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )
        expect(html).toContain("Only the owner can approve")
        expect(html).toContain("You can read this chat.")
    })
})

describe("the change card of a builder edit (task 8.2)", () => {
    const recorded = editAgentConfigTurn.message.parts
    const preview = (recorded[0] as {data: {preview: unknown}}).data.preview
    const input = (recorded[1] as {input: unknown}).input
    const card = (changePreview?: unknown) =>
        renderToStaticMarkup(
            <ApprovalCard
                approvals={[
                    {approvalId: "perm-1", toolName: "edit_agent_config", input, changePreview},
                ]}
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )

    it("shows the old and the new values of the server preview", () => {
        const html = card(preview)
        expect(html).toContain('data-testid="change-sections"')
        expect(html).toMatch(/data-testid="change-old"[^>]*>claude-sonnet-5-5</)
        expect(html).toMatch(/data-testid="change-new"[^>]*>claude-opus-5-5</)
        expect(html).not.toContain('data-testid="change-proposed"')
        // The changes show in place; the toggle would repeat them.
        expect(html).not.toContain("See what changes")
    })

    it("keeps a changed line that starts like a diff header", () => {
        const html = card({
            applies: true,
            operations: [{index: 0, applies: true}],
            changes: [
                {
                    path: ["parameters", "agent", "instructions", "agents_md"],
                    operation_indexes: [0],
                    kind: "changed",
                    diff: "--- old\n+++ new\n@@ -1,2 +1,2 @@\n Intro\n----\n+++ bold\n",
                },
            ],
        })
        expect(html).not.toContain(">-- old<")
        // The sign goes to the gutter; the rest of the line is its text.
        expect(html).toContain(">---<")
        expect(html).toContain(">++ bold<")
    })

    it("says a refused change cannot apply and marks the failing change", () => {
        const html = card(editAgentConfigTurn.failedPreview)
        expect(html).toContain("This change cannot be applied to the current version of the agent.")
        expect(html).toContain('data-fails="true"')
        expect(html).not.toContain("does not occur")
        expect(html).not.toContain('data-testid="change-proposed"')
    })

    it("shows the proposed values with a label when the call has no preview", () => {
        const html = card(undefined)
        expect(html).toContain("Proposed values. The current values could not be loaded.")
        expect(html).not.toMatch(/data-testid="change-old"[^>]*>claude-sonnet-5-5</)
        expect(html).toContain("Approve")
    })

    it("has a header per change, and a footer that says which version it saves", () => {
        const html = card(preview)
        expect(html).toContain("3 changes to support-triage")
        expect(html).toContain("Edit the instructions")
        expect(html).toContain("Instructions › AGENTS.md")
        expect(html).toMatch(/data-testid="change-saves-as"[^>]*>Saves as v5</)
        // The change is the header: no eyebrow and no tool sentence while it waits.
        expect(html).not.toContain("Needs your approval")
        expect(html).not.toContain("Agenta saves this as a new version")
        expect(html).not.toContain('data-testid="change-conflict"')
    })

    it("shows the conflict before a click when a newer version landed", () => {
        versions.latest = 5
        const html = card(preview)
        expect(html).toContain('data-testid="change-conflict"')
        expect(html).toContain("Someone saved v5 after the builder read v4.")
        // The number does not follow the latest version.
        expect(html).toContain("Saves as v5")
        expect(html).toContain("Approve")
    })

    it("says no version when the base version is not known", () => {
        expect(card(undefined)).not.toContain("change-saves-as")
    })

    it("words the main button Remove for a card that only removes", () => {
        const gmail = {list: "tools", key: "gateway_connection:composio:gmail"}
        const html = renderToStaticMarkup(
            <ApprovalCard
                approvals={[
                    {
                        approvalId: "perm-2",
                        toolName: "edit_agent_config",
                        input: {
                            agent: "support-triage",
                            operations: [
                                {operation: "remove_item", target: ["parameters", "agent", gmail]},
                            ],
                        },
                    },
                ]}
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )
        expect(html).toContain("Remove an integration")
        // A card with one change starts its path at the section, as C01 and M05 draw it.
        expect(html).toContain("Integrations")
        expect(html).not.toContain("support-triage ›")
        expect(html).toContain("No longer available to the agent")
        expect(html).toMatch(/>Remove</)
        expect(html).not.toMatch(/>Approve</)
    })

    it("shows the warning line and border of a risky change", () => {
        const target = [
            "parameters",
            "agent",
            {list: "tools", key: "gateway_connection:composio:zendesk"},
            "policy",
            "permissions",
            "tools",
            "ZENDESK_CLOSE_TICKET",
        ]
        const html = renderToStaticMarkup(
            <ApprovalCard
                approvals={[
                    {
                        approvalId: "perm-3",
                        toolName: "edit_agent_config",
                        input: {
                            agent: "support-triage",
                            operations: [{operation: "set", target, value: "allow"}],
                        },
                    },
                ]}
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )
        expect(html).toContain('data-testid="change-risk"')
        expect(html).toContain("The agent will use Close ticket without asking you.")
        expect(html).toContain("!border-colorWarningBorder")
    })
})

describe("the grouped card of several change calls (task 26.2)", () => {
    const call = (id: string, value: string) => ({
        approvalId: id,
        toolName: "edit_agent_config",
        input: {
            agent: "Support triage",
            base_revision_id: "rev-4",
            operations: [
                {
                    operation: "set",
                    target: ["parameters", "agent", "llm", "model"],
                    value,
                },
            ],
        },
        changePreview: {
            applies: true,
            base: {id: "rev-4", version: "4"},
            operations: [{index: 0, applies: true}],
            changes: [
                {
                    path: ["parameters", "agent", "llm", "model"],
                    operation_indexes: [0],
                    kind: "changed",
                    old: "claude-sonnet-5.5",
                    new: value,
                },
            ],
        },
    })
    const render = (onDenyAll?: () => void) =>
        renderToStaticMarkup(
            <ApprovalCard
                approvals={[call("a1", "claude-opus-5.5"), call("a2", "gpt-6")]}
                onRespond={() => undefined}
                onApproveAll={() => undefined}
                onDenyAll={onDenyAll}
            />,
        )

    it("shows one group per call, each saved as its own version", () => {
        const html = render(() => undefined)
        expect(html).toContain("2 changes to Support triage")
        expect(html.match(/Saved together as v5/g)?.length).toBe(2)
        expect(html.match(/data-testid="change-block-row"/g)?.length).toBe(2)
        expect(html).toContain("claude-sonnet-5.5 to claude-opus-5.5")
        expect(html).toContain("Open a row to see its details")
        expect(html).toContain("Deny all")
        expect(html).toContain("Approve all")
        // No list of actions behind a toggle: the groups are the details.
        expect(html).not.toContain("See what runs")
    })

    it("shows the conflict state of a group before a click", () => {
        versions.latest = 5
        expect(render()).toContain('data-testid="change-conflict"')
    })

    it("names the agent of each group when the calls change several agents", () => {
        const other = call("a2", "gpt-6")
        const html = renderToStaticMarkup(
            <ApprovalCard
                approvals={[
                    call("a1", "claude-opus-5.5"),
                    {...other, input: {...other.input, agent: "Refund checker"}},
                ]}
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )
        expect(html).toContain("2 changes")
        expect(html).toContain(">Support triage<")
        expect(html).toContain(">Refund checker<")
    })

    it("keeps the list of actions for a batch with another tool", () => {
        const html = renderToStaticMarkup(
            <ApprovalCard
                approvals={[
                    call("a1", "claude-opus-5.5"),
                    {approvalId: "a2", toolName: "bash", input: {command: "ls"}},
                ]}
                onRespond={() => undefined}
                onApproveAll={() => undefined}
            />,
        )
        expect(html).toContain("See what runs (2)")
        expect(html).not.toContain("Saved together")
    })
})
