// @vitest-environment jsdom
//
// A turn the user stopped, as `/m` draws it.
//
// The common stop lands while a call runs: the runner records the call as failed
// (`INTERRUPTED_BY_USER`) and the turn as stopped. The fold hides a failed call by product rule,
// so the "Stopped" label is the only thing that says what happened. It must key on the answer the
// row shows, not on `hasAnswer`, which counts that hidden call as an answer.
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

const interruptedCall = {
    type: "tool-Terminal",
    toolCallId: "call-terminal",
    state: "output-error",
    input: {command: "sleep 60"},
    errorText: "INTERRUPTED_BY_USER: the user stopped the run",
}

const finishedCall = {
    type: "tool-read_file",
    toolCallId: "call-read",
    state: "output-available",
    input: {path: "README.md"},
    output: "# Readme",
}

const answer = {type: "text", text: "Here is the answer.", state: "done"}

const renderTurn = (parts: unknown[], metadata?: Record<string, unknown>): string => {
    const message = {id: "turn-1", role: "assistant", parts, metadata} as unknown as UIMessage
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
                    <TurnRow turn={turn} sessionId="session-1" />
                </Provider>
            </WithQueryClient>,
        )
    })
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("mobile TurnRow: a turn the user stopped", () => {
    it("reads Stopped when the stop interrupted the running call", () => {
        const text = renderTurn([interruptedCall], {runStopped: true})

        expect(text).toContain("Stopped")
        expect(text).not.toContain("No response")
    })

    it("reads Stopped when nothing was produced", () => {
        expect(renderTurn([], {runStopped: true})).toContain("Stopped")
    })

    it("reads Stopped after the steps when no answer text came", () => {
        const text = renderTurn([finishedCall, interruptedCall], {runStopped: true})

        expect(text).toContain("Worked")
        expect(text).toContain("Stopped")
        expect(text.indexOf("Worked")).toBeLessThan(text.indexOf("Stopped"))
    })

    it("keeps the answer alone when the answer text is shown", () => {
        const text = renderTurn([finishedCall, answer], {runStopped: true})

        expect(text).toContain("Here is the answer.")
        expect(text).not.toContain("Stopped")
    })

    it("reads Stopped after the denied step when the stop landed on a pending approval", () => {
        // The shape `transcriptToMessages` leaves when a stop settles an approval card.
        const deniedCall = {
            type: "tool-write_file",
            toolCallId: "call-write",
            state: "output-denied",
            input: {path: "notes.md"},
            approval: {id: "approval-1"},
        }
        const text = renderTurn([deniedCall], {runStopped: true})

        expect(text).toContain("You denied writing a file")
        expect(text).toContain("Stopped")
        expect(text.indexOf("You denied writing a file")).toBeLessThan(text.indexOf("Stopped"))
    })

    it("does not read Stopped on a turn the user did not stop", () => {
        expect(renderTurn([interruptedCall])).not.toContain("Stopped")
    })
})
