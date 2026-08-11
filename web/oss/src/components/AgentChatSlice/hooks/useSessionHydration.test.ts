/**
 * Unit test for `shouldSkipRecordsRefresh` — the guard that stops the records-changed relay from
 * clobbering a client-tool settle that hasn't resumed yet.
 *
 * Regression: clicking "Not now" on a parked connect request fired zero network requests and the
 * interaction stayed `pending` forever (live evidence: sessions e8c3b72a-0fb0-4895-a77d-3f073672da8a
 * and 9d4e0324-344c-42f0-ab72-a7afe0246b72 on the 8180 dev stack — reproduced live: clicking "Not
 * now" produced no new `/services/agent/v0/invoke` request, and the transcript visibly reverted to
 * an earlier turn). Root cause: `useSessionRecordsWatch`'s relay can tick and adopt a server
 * transcript while the run is idle (`busy=false`, since the resume hasn't been dispatched yet) but a
 * local `addToolOutput` settle is still waiting for `sendAutomaticallyWhen` to fire — the adopted
 * transcript predates the settle and silently discards it.
 */
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {shouldAdoptTranscript, shouldSkipRecordsRefresh} from "./useSessionHydration"

type ToolState = "input-available" | "output-available"

const toolMessage = ({
    id,
    toolCallId,
    state,
    type = "tool-request_input",
}: {
    id: string
    toolCallId: string
    state: ToolState
    type?: "tool-request_input" | "dynamic-tool"
}): UIMessage => ({
    id,
    role: "assistant",
    parts: [
        {
            type,
            ...(type === "dynamic-tool" ? {toolName: "request_input"} : {}),
            toolCallId,
            state,
            input: {},
            ...(state === "output-available" ? {output: {submitted: true}} : {}),
        },
        // A dynamic-tool part carries its client-tool identity only in this sibling, exactly as
        // replay emits it — the tool name is not readable off `type` there.
        ...(type === "dynamic-tool"
            ? [{type: "data-render", data: {toolCallId, render: {kind: "elicitation"}}}]
            : []),
    ] as UIMessage["parts"],
})

const textMessage = (id: string): UIMessage => ({
    id,
    role: "user",
    parts: [{type: "text", text: "hello"}],
})

describe("shouldSkipRecordsRefresh", () => {
    it("does not skip when idle and no settle is pending a resume", () => {
        expect(shouldSkipRecordsRefresh({busy: false, pendingResume: false})).toBe(false)
    })

    it("skips while this tab is streaming (existing busy guard)", () => {
        expect(shouldSkipRecordsRefresh({busy: true, pendingResume: false})).toBe(true)
    })

    it("skips while a client-tool settle awaits its resume dispatch, even though busy=false", () => {
        // This is the exact gap the bug lived in: not busy yet, but not safe to adopt either.
        expect(shouldSkipRecordsRefresh({busy: false, pendingResume: true})).toBe(true)
    })

    it("skips when both are true", () => {
        expect(shouldSkipRecordsRefresh({busy: true, pendingResume: true})).toBe(true)
    })
})

/**
 * The composed decision, where the card predicates meet the watermark and the floors. Review round 3
 * finding 1: the settled-card path is meant to bypass ONLY the growth test. Bypassing the
 * anti-truncation floor too would let a lagging snapshot replace the screen and localStorage, regress
 * the watermark, and release the composer against a truncated history.
 */
describe("shouldAdoptTranscript", () => {
    const waiting = (id: string) =>
        toolMessage({id: `local-${id}`, toolCallId: id, state: "input-available"})
    const settledCard = (id: string) =>
        toolMessage({id: `server-${id}`, toolCallId: id, state: "output-available"})

    const base = {
        serverRecordCount: 44,
        watermark: 44,
        busy: false,
        pendingResume: false,
    }

    it("adopts the zombie case: equal counts, equal records, card settled server-side", () => {
        expect(
            shouldAdoptTranscript({
                ...base,
                localMessages: [waiting("call-1")],
                serverMessages: [settledCard("call-1")],
            }),
        ).toBe(true)
    })

    it("REFUSES a lagging snapshot that settles the card but drops the newest turn", () => {
        expect(
            shouldAdoptTranscript({
                ...base,
                serverRecordCount: 40,
                localMessages: [waiting("call-1"), textMessage("newest-turn")],
                serverMessages: [settledCard("call-1")],
            }),
        ).toBe(false)
    })

    it("refuses a shorter snapshot even when the record count has not regressed", () => {
        expect(
            shouldAdoptTranscript({
                ...base,
                localMessages: [waiting("call-1"), textMessage("newest-turn")],
                serverMessages: [settledCard("call-1")],
            }),
        ).toBe(false)
    })

    it("refuses while a recorded answer is still waiting on its resume dispatch", () => {
        expect(
            shouldAdoptTranscript({
                ...base,
                pendingResume: true,
                localMessages: [waiting("call-1")],
                serverMessages: [settledCard("call-1")],
            }),
        ).toBe(false)
    })

    it("refuses while this tab is streaming", () => {
        expect(
            shouldAdoptTranscript({
                ...base,
                busy: true,
                localMessages: [waiting("call-1")],
                serverMessages: [settledCard("call-1")],
            }),
        ).toBe(false)
    })

    it("refuses when the server copy still shows the card waiting", () => {
        expect(
            shouldAdoptTranscript({
                ...base,
                serverRecordCount: 99,
                localMessages: [waiting("call-1")],
                serverMessages: [waiting("call-1")],
            }),
        ).toBe(false)
    })

    it("still adopts on plain record growth when nothing is waiting", () => {
        expect(
            shouldAdoptTranscript({
                ...base,
                serverRecordCount: 50,
                localMessages: [textMessage("local")],
                serverMessages: [textMessage("server"), textMessage("server-2")],
            }),
        ).toBe(true)
    })

    it("does not adopt an unchanged log when nothing is waiting", () => {
        expect(
            shouldAdoptTranscript({
                ...base,
                localMessages: [textMessage("local")],
                serverMessages: [textMessage("server")],
            }),
        ).toBe(false)
    })
})

/**
 * The waiting-card semantics, asserted through the decision the user actually gets. Counts are held
 * at equality so ONLY the card logic decides: a card the server copy does not settle must never be
 * overwritten (the user may be mid-answer), and a card it does settle is what lets a dead session's
 * stale copy be replaced at all.
 */
describe("shouldAdoptTranscript: waiting cards", () => {
    const at = (localMessages: UIMessage[], serverMessages: UIMessage[]) =>
        shouldAdoptTranscript({
            serverRecordCount: 44,
            watermark: 44,
            busy: false,
            pendingResume: false,
            localMessages,
            serverMessages,
        })
    const waiting = (id: string, key = "local") =>
        toolMessage({id: `${key}-${id}`, toolCallId: id, state: "input-available"})
    const settledCard = (id: string, key = "server") =>
        toolMessage({id: `${key}-${id}`, toolCallId: id, state: "output-available"})

    it("does not adopt an unchanged log when no card is waiting", () => {
        expect(at([settledCard("call-1", "local")], [settledCard("call-1")])).toBe(false)
    })

    it("refuses when the waiting card is absent from the server copy", () => {
        expect(at([waiting("call-1")], [textMessage("server")])).toBe(false)
    })

    it("refuses when the server copy still shows the card waiting", () => {
        expect(at([waiting("call-1")], [waiting("call-1", "server")])).toBe(false)
    })

    it("adopts when the server copy settles the card", () => {
        expect(at([waiting("call-1")], [settledCard("call-1")])).toBe(true)
    })

    it("refuses when only one of two waiting cards is settled", () => {
        expect(
            at(
                [waiting("call-1"), waiting("call-2")],
                [settledCard("call-1"), waiting("call-2", "server")],
            ),
        ).toBe(false)
    })

    it("ignores an ordinary server tool stuck at input-available", () => {
        // An interrupted turn leaves one behind forever; treating it as a card would both freeze
        // adoption and, worse, let the settled-card path fire on a tool nobody is waiting on.
        // Both assertions below FLIP if `pendingClientToolCallIds` ever counts it as a card —
        // an equal-counts case alone cannot tell the two apart (both refuse), so it is not enough.
        const stuck: UIMessage = {
            id: "local",
            role: "assistant",
            parts: [
                {type: "tool-read_file", toolCallId: "call-9", state: "input-available", input: {}},
            ] as UIMessage["parts"],
        }
        // Freeze check: the log grew, so a stuck server tool must not hold adoption back.
        expect(
            shouldAdoptTranscript({
                serverRecordCount: 50,
                watermark: 44,
                busy: false,
                pendingResume: false,
                localMessages: [stuck],
                serverMessages: [textMessage("server")],
            }),
        ).toBe(true)
        // Settled-card check: nothing is WAITING, so an unchanged log must not adopt just because
        // the server copy shows that same tool settled.
        expect(
            at(
                [stuck],
                [
                    {
                        id: "server",
                        role: "assistant",
                        parts: [
                            {
                                type: "tool-read_file",
                                toolCallId: "call-9",
                                state: "output-available",
                                input: {},
                                output: {ok: true},
                            },
                        ] as UIMessage["parts"],
                    },
                ],
            ),
        ).toBe(false)
    })

    it("finds a waiting dynamic-tool card before the last message", () => {
        const card = toolMessage({
            id: "local-card",
            toolCallId: "call-1",
            state: "input-available",
            type: "dynamic-tool",
        })
        expect(at([card, textMessage("local-tail")], [textMessage("server")])).toBe(false)
        expect(
            at(
                [card, textMessage("local-tail")],
                [settledCard("call-1"), textMessage("server-tail")],
            ),
        ).toBe(true)
    })
})
