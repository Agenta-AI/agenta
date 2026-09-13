// @vitest-environment jsdom
//
// A refused send that carried only files has no words to paint. Mobile used to suppress the whole
// content container for a message with no text, which discarded the failure note and left an
// attachment card sitting there looking like an upload that worked.
//
// This pins the render decision on `/m`: the note is shown INSTEAD of the (empty) content, and the
// attachment card is still there beside it. The row is the recovery surface on this host, because
// its composer has no restorer, so losing the note loses the only statement that the send failed.
import {act} from "react"

import {PENDING_SEND_FAILED_NOTE} from "@agenta/chat/assets"
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

const attachment = {
    type: "file",
    url: "https://files.test/brief.pdf",
    mediaType: "application/pdf",
    filename: "brief.pdf",
}

const renderTurn = (parts: unknown[], metadata?: Record<string, unknown>): string => {
    const message = {
        id: "pending-send-echo-1",
        role: "user",
        parts,
        ...(metadata ? {metadata} : {}),
    } as unknown as UIMessage
    const [turn] = buildTurnViewModels([message], {
        busy: false,
        executedFor: createExecutedToolIdentityCache(),
    })
    host = document.createElement("div")
    root = createRoot(host)
    act(() => {
        root!.render(
            <Provider store={createStore()}>
                <TurnRow turn={turn} sessionId="session-1" />
            </Provider>,
        )
    })
    return host.innerHTML
}

const textOf = (html: string): string => {
    const box = document.createElement("div")
    box.innerHTML = html
    return (box.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("mobile TurnRow: a refused file-only send", () => {
    it("shows the failure note when the message carries only an attachment", () => {
        const html = renderTurn([attachment], {pendingSend: true, pendingSendFailed: true})

        expect(html).toContain('data-pending-send-failed="true"')
        expect(textOf(html)).toContain(PENDING_SEND_FAILED_NOTE)
        expect(textOf(html)).toContain("brief.pdf")
    })

    it("shows the failure note under the words when the send also had text", () => {
        const html = renderTurn([{type: "text", text: "please read this"}, attachment], {
            pendingSend: true,
            pendingSendFailed: true,
        })

        expect(html).toContain('data-pending-send-failed="true"')
        expect(textOf(html)).toContain(PENDING_SEND_FAILED_NOTE)
        expect(textOf(html)).toContain("please read this")
        expect(textOf(html)).toContain("brief.pdf")
    })

    it("says nothing about a failure on an ordinary file-only turn", () => {
        const html = renderTurn([attachment])

        expect(html).not.toContain("data-pending-send-failed")
        expect(textOf(html)).not.toContain(PENDING_SEND_FAILED_NOTE)
    })
})
