// @vitest-environment jsdom
//
// A turn against a disconnected MCP server, as `/m` draws it (UI QA round 3, D2).
//
// The runner emits the handshake failure with the remedy attached and the SDK projects it to the
// browser. Before this the chat read that part nowhere, so what a person saw was the harness's
// own `No such tool available` — nothing about authorization, nothing to act on.
//
// The payload-to-sentence mapping and the fold into render items are pinned in `@agenta/chat`.
// What is pinned here is this app's half: that the row renders the notice card at all, above the
// activity timeline rather than inside it, and that the errored call for a server the turn already
// explains is not sitting beside it. The timeline folds only calls, client tools and the model's
// own text, and it hides failed calls outright, so a notice rendered as a step would vanish along
// with the failure it explains.
import {act} from "react"

import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {TurnRow} from "@/features/chat/TurnRow"

vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))

// The project's MCP connections, which the card needs before it may offer Reconnect: the action
// carries the row's id and slug. Stubbed at the module the card reads it from, with the one row
// the notice names.
//
// SEED THIS IN ANY NEW NOTICE CASE. Without it `findCustomMcpEndpoint` resolves nothing,
// `canConnect` is false, and the card renders its sentence with no action — so a case that
// asserts only the copy passes whether or not the reader has a way back, which is the half of
// this card that does anything. Every case here did exactly that until round 6e.
vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => {
    const {atom} = await import("jotai")
    const original = await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()
    return {
        ...original,
        mcpEndpointsQueryAtom: atom({
            data: [{id: "endpoint-1", slug: "mock-mcp", name: "mock-mcp", url: "https://mcp.test"}],
            isPending: false,
        }),
        refreshMcpEndpointsAtom: atom(null, () => undefined),
    }
})
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
        // The notice and its own action, and NOTHING else. The failed row's error text only
        // appears once the row is expanded, so asserting the absence of the harness sentence let
        // a rendered row through; the whole text is asserted instead, action included.
        expect(textOf(html)).toBe(
            "mock-mcp needs a new sign-in." +
                "Its tools fail until someone in the project reconnects." +
                "Reconnect",
        )
    })

    it("draws the notice and its Reconnect for the frame the stream really sends", () => {
        // The whole chain against main's turn model, from the frame shape on the wire: a
        // `data-mcp-server-failed` part with `handshake_http_error` and the `auth_required`
        // detail, folded into an `mcpNotice` render item, rendered above the activity timeline.
        // The action is half the card: a reader who is told a server did not join and is given
        // no way back has learned nothing they can act on.
        const html = renderTurn([noticePart(), failedToolPart("mcp__mock-mcp__echo")])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        expect(html).toContain('aria-label="Reconnect mock-mcp"')
        expect(textOf(html)).toContain("Reconnect")
    })

    it("shows the failed call when no notice on the turn accounts for it", () => {
        // The state round 6e hit: a disconnected connection, a call that could not run, and no
        // notice part on the turn. The timeline hides a failed call by product rule, so hiding
        // this one too left the turn saying nothing at all — no card, no row, no error text. A
        // failure nothing else explains is the one a reader has to see.
        const html = renderTurn([failedToolPart("mcp__mock-mcp__echo")])

        expect(html).not.toContain("data-mcp-server-notice")
        // The timeline itself: with no steps it draws no fold at all, so its summary line is what
        // says the call reached the reader, and the call's own label is what says which call.
        expect(textOf(html)).toContain("Worked")
        expect(textOf(html)).toContain("Echo")
    })

    it("leaves main's rule alone for a failed call that is not an MCP one", () => {
        // The exception is scoped. An ordinary tool that failed is usually one the agent retried
        // and recovered from, which is why main keeps it off the timeline; an MCP call against a
        // server that never joined is the failure it cannot recover from and nothing else reports.
        // Widening the fallback to every tool would put a red row back on every recovered turn.
        const html = renderTurn([failedToolPart("read_file")])

        expect(textOf(html)).not.toContain("Worked")
    })

    it("still hides the failed call that a notice does account for", () => {
        // The other direction, so the fallback cannot become "every failure is a step again":
        // main's rule stands wherever the card speaks for the call.
        const html = renderTurn([noticePart(), failedToolPart("mcp__mock-mcp__echo")])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        expect(textOf(html)).not.toContain("Worked")
    })

    it("draws the notice whether or not the call behind it is on the timeline", () => {
        // The timeline hides a failed call by product rule (`hiddenFromFold`), and the notice is
        // derived from exactly such a call, so the card is the reader's ONLY signal that a server
        // is missing. It renders above the timeline rather than as a step, so nothing about which
        // calls the fold shows can take it away.
        const html = renderTurn([noticePart(), failedToolPart("mcp__other-server__search")])

        expect(html).toContain('data-mcp-server-notice="mock-mcp"')
        expect(textOf(html)).not.toContain("Other server failed")
    })
})
