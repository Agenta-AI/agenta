// @vitest-environment jsdom
//
// The mobile turn's wiring into the shared run-failure callout.
//
// This app drew its own callout, a private `RunErrorCallout` that reimplemented the desktop's
// rather than copying it: its own clamp threshold, its own toggle wording, its own retry rule, and
// no test. Both apps render the package's component now.
//
// What is pinned here is this app's half: a failed turn renders it with the run's reason, the
// retry is offered for the one class this app passes a retry for, and neither escape that leaves
// the chat is drawn, because this app has no provider drawer to open.
import {act} from "react"

import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it} from "vitest"

import {TurnRow} from "@/features/chat/TurnRow"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
})

const failedTurn = (message: string, code?: string): UIMessage =>
    ({
        id: "turn-1",
        role: "assistant",
        parts: [],
        metadata: {runError: {message, ...(code ? {code} : {})}},
    }) as unknown as UIMessage

/** Rendered as the last turn, which is the only turn this app offers a retry on. */
const renderTurn = (message: UIMessage): string => {
    const [turn] = buildTurnViewModels([message], {
        busy: false,
        executedFor: createExecutedToolIdentityCache(),
    })
    host = document.createElement("div")
    root = createRoot(host)
    act(() => {
        root!.render(
            <Provider store={createStore()}>
                <TurnRow turn={turn} sessionId="session-1" onRewind={() => undefined} />
            </Provider>,
        )
    })
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("mobile TurnRow: a run that failed", () => {
    it("renders the shared callout with the run's own reason", () => {
        const shown = renderTurn(failedTurn("model authentication failed"))

        expect(shown).toContain("The agent run failed")
        expect(shown).toContain("model authentication failed")
    })

    it("offers Try again for the continuation race, which is the class it passes a retry for", () => {
        expect(
            renderTurn(failedTurn("This turn was resumed elsewhere.", "continuation_resumed")),
        ).toContain("Try again")
    })

    it("draws no escape that leaves the chat: this app has no provider drawer", () => {
        const shown = renderTurn(failedTurn("Out of starter credits.", "starter_credits_exhausted"))

        expect(shown).toContain("Out of starter credits.")
        expect(shown).not.toContain("Add your key")
        expect(shown).not.toContain("Sign in again")
    })
})
