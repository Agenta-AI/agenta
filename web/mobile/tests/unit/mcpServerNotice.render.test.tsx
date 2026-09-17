// @vitest-environment jsdom
//
// A turn against a disconnected MCP server, as `/m` draws it (UI QA round 3, D2).
//
// The runner emits the handshake failure with the remedy attached and the SDK projects it to the
// browser. Before this the chat read that part nowhere, so what a person saw was the harness's
// own `No such tool available` — nothing about authorization, nothing to act on.
//
// The payload-to-sentence mapping and the fold into render items are pinned in `@agenta/chat`.
// What is pinned here is this app's half: that the row renders the notice card at all, and that
// the errored call for a server the turn already explains is not sitting beside it.
import {act} from "react"

import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {TurnRow} from "@/features/chat/TurnRow"

vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
})

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

const renderTurn = (parts: unknown[]): string => {
    const message = {id: "turn-1", role: "assistant", parts} as unknown as UIMessage
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

describe("mobile TurnRow: an MCP server that did not join the run", () => {
    it("states that the server needs authorizing, in the reader's words not the runner's", () => {
        const html = renderTurn([noticePart()])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        // The two halves are separate elements in the banner, so they are matched separately.
        expect(textOf(html)).toContain("mock-mcp needs a new sign-in.")
        expect(textOf(html)).toContain("Its tools fail until someone in the project reconnects.")
        // The marker is addressed to the runner; it has no business on a screen.
        expect(textOf(html)).not.toContain("agenta_code")
    })

    it("shows one answer, not the harness's error beside the notice", () => {
        const html = renderTurn([noticePart(), failedToolPart("mcp__mock-mcp__echo")])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        // The notice and NOTHING else. The failed row's own error text only appears once the row
        // is expanded, so asserting the absence of the harness sentence let a rendered row through.
        expect(textOf(html)).toBe(
            "mock-mcp needs a new sign-in.Its tools fail until someone in the project reconnects.",
        )
    })

    it("keeps a failure from a server the turn says nothing about", () => {
        const html = renderTurn([noticePart(), failedToolPart("mcp__other-server__search")])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        expect(textOf(html)).toContain("Other server failed")
    })
})
