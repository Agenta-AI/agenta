// @vitest-environment jsdom
//
// A turn parked on a question, as `/m` draws it.
//
// The agent's messages show below the fold, never in it, so its lead-in to a question is readable
// while the run waits on the reader.
import {act} from "react"

import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

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

const leadIn = {type: "text", text: "Let me check what you already know.", state: "done"}

// A first malformed form settles as an error and is hidden, so the lead-in trails the turn.
const degradedQuestion = {
    type: "tool-__ag__request_input",
    toolCallId: "call-ask",
    state: "output-error",
    input: {message: "How familiar are you?", requestedSchema: {}},
    errorText: "elicitation: unsupported payload — missing requestedSchema",
}

const renderTurn = (props: {waitingOnUser?: boolean; resuming?: boolean}): HTMLElement => {
    const message = {
        id: "turn-1",
        role: "assistant",
        parts: [leadIn, degradedQuestion],
    } as unknown as UIMessage
    const [turn] = buildTurnViewModels([message], {
        busy: false,
        executedFor: createExecutedToolIdentityCache(),
    })
    const host = document.createElement("div")
    root = createRoot(host)
    act(() => {
        root!.render(
            <WithQueryClient>
                <Provider store={createStore()}>
                    <TurnRow turn={turn} sessionId="session-1" {...props} />
                </Provider>
            </WithQueryClient>,
        )
    })
    return host
}

describe("mobile TurnRow: a turn parked on a question", () => {
    it("shows the lead-in under Waiting for you while waiting on the reader", () => {
        const host = renderTurn({waitingOnUser: true})

        expect(host.textContent).toContain("Waiting for you")
        expect(host.querySelector("[data-quotable]")?.textContent).toContain(leadIn.text)
    })

    it("keeps the lead-in on screen while the answer is on its way back", () => {
        const host = renderTurn({resuming: true})

        expect(host.querySelector("[data-quotable]")?.textContent).toContain(leadIn.text)
    })

    it("shows the trailing text as the answer once the run is over", () => {
        const host = renderTurn({})

        expect(host.querySelector("[data-quotable]")?.textContent).toContain(leadIn.text)
    })
})
