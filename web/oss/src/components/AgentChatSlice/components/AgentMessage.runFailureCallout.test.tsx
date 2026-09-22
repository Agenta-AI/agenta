/**
 * The desktop turn's wiring into the shared run-failure callout.
 *
 * The callout's own states are pinned in `@agenta/chat`, where the component lives. What is
 * pinned here is this app's half: that a failed turn renders it, and that the two escapes which
 * leave the chat are wired, because they are props and this app is the one with a provider drawer
 * to send the reader to. Without the wiring the class would be recognised and the button withheld,
 * which no test in the package can see.
 */
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import AgentMessage from "./AgentMessage"

const failedTurn = (message: string, code?: string): UIMessage =>
    ({
        id: "turn-1",
        role: "assistant",
        parts: [],
        metadata: {runError: {message, ...(code ? {code} : {})}},
    }) as unknown as UIMessage

const text = (turn: UIMessage): string => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(
        <Provider store={createStore()}>
            <AgentMessage
                message={turn}
                sessionId="session-1"
                precededByEmptyAssistant={false}
                onRewind={() => undefined}
                onClientToolOutput={() => undefined}
            />
        </Provider>,
    )
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("AgentMessage: a run that failed", () => {
    it("renders the shared callout with the run's own reason", () => {
        expect(text(failedTurn("model authentication failed"))).toContain("The agent run failed")
        expect(text(failedTurn("model authentication failed"))).toContain(
            "model authentication failed",
        )
    })

    it("wires the own-key escape, which this app has somewhere to open", () => {
        expect(text(failedTurn("Out of starter credits.", "starter_credits_exhausted"))).toContain(
            "Add your key",
        )
    })

    it("wires the sign-in escape on the same grounds", () => {
        expect(
            text(failedTurn("The sign-in is no longer valid.", "subscription_login_required")),
        ).toContain("Sign in again")
    })
})
