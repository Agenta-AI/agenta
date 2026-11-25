// @vitest-environment jsdom
//
// The result rows of answered change calls in a /m turn (task 26.1). A turn with no change call
// renders as before; an answered builder edit gets its row after the fold, with the actions the
// conversation allows.
import {act} from "react"

import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import {
    versionHistoryOpenAtomFamily,
    versionHistorySelectedAtomFamily,
} from "@agenta/playground-ui/agent-version-history/store"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ChangeResultHostContext} from "@/features/chat/changeResultHost"
import {TurnRow} from "@/features/chat/TurnRow"

import {WithQueryClient} from "../support/queryClient"

vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
})

const finishedCall = {
    type: "tool-read_file",
    toolCallId: "call-read",
    state: "output-available",
    input: {path: "README.md"},
    output: "# Readme",
}
const answer = {type: "text", text: "Here is the answer.", state: "done"}

const conflictCall = {
    type: "tool-edit_agent_config",
    toolCallId: "call-edit",
    state: "output-error",
    input: {
        agent: "Support triage",
        base_revision_id: "rev-4",
        operations: [
            {operation: "set", target: ["parameters", "agent", "llm", "model"], value: "x"},
        ],
    },
    approval: {id: "perm-1", approved: true},
    errorText: `tool call tools.agenta.edit_agent_config failed: The workflow head changed.\n${JSON.stringify(
        {code: "revision_conflict", message: "The workflow head changed.", retryable: false},
    )}`,
}

const renderTurn = (
    parts: unknown[],
    host?: {readOnly: boolean; send?: (text: string) => void},
    store = createStore(),
): HTMLElement => {
    const message = {id: "turn-1", role: "assistant", parts} as unknown as UIMessage
    const [turn] = buildTurnViewModels([message], {
        busy: false,
        executedFor: createExecutedToolIdentityCache(),
    })
    const element = document.createElement("div")
    root = createRoot(element)
    const row = <TurnRow turn={turn} sessionId="session-1" />
    act(() => {
        root!.render(
            <WithQueryClient>
                <Provider store={store}>
                    {host ? (
                        <ChangeResultHostContext.Provider value={host}>
                            {row}
                        </ChangeResultHostContext.Provider>
                    ) : (
                        row
                    )}
                </Provider>
            </WithQueryClient>,
        )
    })
    return element
}

describe("mobile TurnRow: change results", () => {
    it("renders a turn with no change call as before", () => {
        const element = renderTurn([finishedCall, answer])
        expect(element.querySelector('[data-testid="change-results"]')).toBeNull()
        expect(element.textContent).toContain("Here is the answer.")
    })

    it("shows the conflict row, and Try again sends the fixed message as the person", () => {
        const sent: string[] = []
        const element = renderTurn([conflictCall, answer], {
            readOnly: false,
            send: (text) => sent.push(text),
        })
        const text = element.textContent ?? ""
        expect(text).toContain("Not saved")
        expect(text).toContain("Someone changed the agent after the builder read it.")
        const button = [...element.querySelectorAll("button")].find(
            (node) => node.textContent === "Try again",
        )
        act(() => button!.click())
        expect(sent).toEqual([
            "Read the agent again and propose the same change on its latest version.",
        ])
        // One message per click: the row stops offering it.
        expect(element.textContent).not.toContain("Try again")
    })

    it("offers no Try again to a reader who cannot send", () => {
        const element = renderTurn([conflictCall])
        expect(element.textContent).toContain("Not saved")
        expect(element.textContent).not.toContain("Try again")
    })

    it("opens the version history on the saved version, and Revert on the one before", () => {
        const savedCall = {
            ...conflictCall,
            state: "output-available",
            errorText: undefined,
            output: {
                status: "committed",
                agent: {id: "agent-1", name: "Support triage"},
                revision: {id: "rev-5", version: "5"},
            },
        }
        const store = createStore()
        const element = renderTurn([savedCall], {readOnly: false}, store)
        const click = (label: string) =>
            act(() =>
                [...element.querySelectorAll("button")]
                    .find((node) => node.textContent === label)!
                    .click(),
            )
        expect(element.textContent).toContain("Saved as v5")
        click("View")
        expect(store.get(versionHistoryOpenAtomFamily("agent-1"))).toBe(true)
        expect(store.get(versionHistorySelectedAtomFamily("agent-1"))).toBe("rev-5")
        click("Revert")
        expect(store.get(versionHistorySelectedAtomFamily("agent-1"))).toBe("rev-4")
    })
})
