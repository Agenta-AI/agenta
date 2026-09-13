/**
 * A refused send that carried only files has no words to paint. Both hosts used to suppress the
 * whole content container for a message with no text, which discarded the failure note and left an
 * attachment card sitting there looking like an upload that worked.
 *
 * This pins the render decision on the desktop: the note is shown INSTEAD of the (empty) content,
 * and the attachment card is still there beside it.
 */
import {PENDING_SEND_FAILED_NOTE} from "@agenta/chat/assets"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import AgentMessage from "./AgentMessage"

const failedEcho = (parts: unknown[]): UIMessage =>
    ({
        id: "pending-send-echo-1",
        role: "user",
        parts,
        metadata: {pendingSend: true, pendingSendFailed: true},
    }) as unknown as UIMessage

/** Markup for attribute assertions, plus its text so an escaped apostrophe cannot fake a red. */
const asDom = (html: string): string => {
    const host = document.createElement("div")
    host.innerHTML = html
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

const render = (message: UIMessage): string =>
    renderToStaticMarkup(
        <Provider store={createStore()}>
            <AgentMessage
                message={message}
                sessionId="session-1"
                onRewind={() => undefined}
                onClientToolOutput={() => undefined}
            />
        </Provider>,
    )

describe("AgentMessage: a refused file-only send", () => {
    it("shows the failure note when the message carries only an attachment", () => {
        const html = render(
            failedEcho([
                {
                    type: "file",
                    url: "https://files.test/brief.pdf",
                    mediaType: "application/pdf",
                    filename: "brief.pdf",
                },
            ]),
        )

        expect(html).toContain('data-pending-send-failed="true"')
        expect(asDom(html)).toContain(PENDING_SEND_FAILED_NOTE)
        // The card stays: the row is the recovery surface when the composer cannot take the files.
        expect(html).toContain("brief.pdf")
    })

    it("shows the failure note under the words when the send also had text", () => {
        const html = render(
            failedEcho([
                {type: "text", text: "please read this"},
                {
                    type: "file",
                    url: "https://files.test/brief.pdf",
                    mediaType: "application/pdf",
                    filename: "brief.pdf",
                },
            ]),
        )

        expect(html).toContain('data-pending-send-failed="true"')
        expect(asDom(html)).toContain(PENDING_SEND_FAILED_NOTE)
        expect(html).toContain("please read this")
        expect(html).toContain("brief.pdf")
    })

    it("says nothing about a failure on an ordinary user turn", () => {
        const html = renderToStaticMarkup(
            <Provider store={createStore()}>
                <AgentMessage
                    message={
                        {
                            id: "m1",
                            role: "user",
                            parts: [{type: "text", text: "hello"}],
                        } as unknown as UIMessage
                    }
                    sessionId="session-1"
                    onRewind={() => undefined}
                    onClientToolOutput={() => undefined}
                />
            </Provider>,
        )

        expect(html).not.toContain("data-pending-send-failed")
        expect(asDom(html)).not.toContain(PENDING_SEND_FAILED_NOTE)
    })
})
