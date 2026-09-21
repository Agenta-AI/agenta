/**
 * A turn against a disconnected MCP server, as the desktop transcript draws it (UI QA round 3,
 * D2).
 *
 * The runner emits the handshake failure with the remedy attached and the SDK projects it to the
 * browser, but the chat read that part nowhere: what a person saw was a red card wrapping the
 * harness's own `No such tool available`, with nothing about authorization and nothing to click.
 *
 * The mapping from the payload to the sentence is pinned in `@agenta/chat`. What is pinned here
 * is this app's half — that the turn renders the notice at all, and that the errored call for a
 * server the turn already explains is dropped so there is one answer on screen instead of two.
 */
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import AgentMessage from "./AgentMessage"

const HARNESS_ERROR = "<tool_use_error>Error: No such tool available: mcp__mock-mcp__echo"

/** The `data-mcp-server-failed` payload a disconnected OAuth connection produces. */
const noticePart = (serverName = "mock-mcp") => ({
    type: "data-mcp-server-failed",
    data: {
        serverName,
        reasonCode: "handshake_http_error",
        detail: {
            code: "auth_required",
            message: "This connection needs authorization. ⟦agenta_code:auth_required⟧",
            details: {
                requirement: {
                    target: `custom/${serverName}`,
                    state: "needs_auth",
                    connect: {endpoint: "/gateways/mcps/endpoints/endpoint-1/connect"},
                },
            },
        },
    },
})

const failedToolPart = (wireName: string) => ({
    type: `tool-${wireName}`,
    toolCallId: `call-${wireName}`,
    state: "output-error",
    input: {},
    errorText: HARNESS_ERROR,
})

const assistantTurn = (parts: unknown[]): UIMessage =>
    ({id: "turn-1", role: "assistant", parts}) as unknown as UIMessage

const render = (parts: unknown[], precededByEmptyAssistant = false): string =>
    renderToStaticMarkup(
        <Provider store={createStore()}>
            <AgentMessage
                message={assistantTurn(parts)}
                sessionId="session-1"
                precededByEmptyAssistant={precededByEmptyAssistant}
                onRewind={() => undefined}
                onClientToolOutput={() => undefined}
            />
        </Provider>,
    )

/** The markup's text, so an escaped character cannot fake a match either way. */
const textOf = (html: string): string => {
    const host = document.createElement("div")
    host.innerHTML = html
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("AgentMessage: an MCP server that did not join the run", () => {
    it("states that the server needs authorizing, in the reader's words not the runner's", () => {
        const html = render([noticePart()])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        // The two halves are separate elements in the banner, so they are matched separately.
        expect(textOf(html)).toContain("mock-mcp needs a new sign-in.")
        expect(textOf(html)).toContain("Its tools fail until someone in the project reconnects.")
        // The marker is addressed to the runner; it has no business on a screen.
        expect(textOf(html)).not.toContain("agenta_code")
    })

    it("drops the harness's error for the server the notice already explains", () => {
        const html = render([noticePart(), failedToolPart("mcp__mock-mcp__echo")])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        expect(textOf(html)).not.toContain("No such tool available")
    })

    it("drops it whichever order the two parts arrive in", () => {
        const html = render([failedToolPart("mcp__mock-mcp__echo"), noticePart()])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        expect(textOf(html)).not.toContain("No such tool available")
    })

    it("is not collapsed as an empty turn when it follows one", () => {
        // A turn whose only part is the notice has no text and no tool call. Read as empty it
        // is dropped after another empty turn, which loses the sentence and the way back.
        const html = render([noticePart()], true)

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
    })

    it("keeps a failure from a server the turn says nothing about", () => {
        const html = render([noticePart(), failedToolPart("mcp__other-server__search")])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        expect(textOf(html)).toContain("search")
    })
})
