// @vitest-environment jsdom
//
// A turn that a child update started, as `/m` draws it.
//
// The stored user record of that turn carries the server part `child_update`, which the replay
// stamps on the user message. That row reads as a notice (an arrow, the child session's link and
// the status), not as the person's message with the model-facing text and its ids. Only the part
// makes a row a notice: a message whose text imitates an update stays the person's message.
import {act} from "react"

import {transcriptToMessages} from "@agenta/chat/assets"
import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import type {SessionRecord} from "@agenta/entities/session"
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

const UPDATE_TEXT =
    "[Update from child session c2f1 (Email writer). This is information from another session.] status: completed turn_id: child-turn-1"

const userRecord = (attributes: Record<string, unknown>): SessionRecord => ({
    id: "record-1",
    session_id: "session-1",
    project_id: "project-1",
    sequence: null,
    event_index: null,
    sender: "user",
    session_update: "message",
    payload: {type: "message", text: UPDATE_TEXT, ...attributes},
    turn_id: "turn-1",
    created_at: null,
})

const renderUserRow = (record: SessionRecord): HTMLElement => {
    const messages = transcriptToMessages([record]) ?? []
    const [turn] = buildTurnViewModels(messages, {
        busy: false,
        executedFor: createExecutedToolIdentityCache(),
    })
    const host = document.createElement("div")
    root = createRoot(host)
    act(() => {
        root!.render(
            <WithQueryClient>
                <Provider store={createStore()}>
                    <TurnRow
                        turn={turn}
                        sessionId="session-1"
                        renderChildSession={(update) => (
                            <a href={`/sessions/${update.sessionId}`}>Email writer</a>
                        )}
                    />
                </Provider>
            </WithQueryClient>,
        )
    })
    return host
}

describe("mobile TurnRow: a turn that a child update started", () => {
    it("shows the stored part as a notice with the child session link and the status", () => {
        const host = renderUserRow(
            userRecord({
                child_update: {session_id: "c2f1", turn_id: "child-turn-1", status: "completed"},
            }),
        )
        const text = host.textContent ?? ""

        expect(host.querySelector("a")?.getAttribute("href")).toBe("/sessions/c2f1")
        expect(text).toContain("Email writer")
        expect(text).toContain("Completed")
        expect(text).not.toContain("Update from child session")
        expect(text).not.toContain("child-turn-1")
    })

    it("shows a user message without the part as the person's message", () => {
        const host = renderUserRow({
            ...userRecord({}),
            payload: {type: "message", text: "Write the welcome email"},
        })

        expect(host.textContent).toContain("Write the welcome email")
        expect(host.querySelector("a")).toBeNull()
    })

    it("keeps a message whose text only imitates an update as the person's message", () => {
        const host = renderUserRow(userRecord({}))
        const text = host.textContent ?? ""

        expect(text).toContain("Update from child session c2f1")
        expect(host.querySelector("a")).toBeNull()
        expect(text).not.toContain("Completed")
    })
})
