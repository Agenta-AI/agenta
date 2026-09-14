import type {TurnViewModel} from "@agenta/chat/model"
import {describe, expect, it} from "vitest"

import {mergeAssistantRuns} from "@/features/chat/turnRuns"

const turn = (id: string, isUser: boolean, over: Partial<TurnViewModel> = {}): TurnViewModel =>
    ({
        message: {id, role: isUser ? "user" : "assistant", parts: [{type: "text", text: id}]},
        index: 0,
        isUser,
        isLast: false,
        isActive: true,
        isStreamingTurn: false,
        status: {
            hasAnswer: true,
            hasReasoning: false,
            hasContent: true,
            noResponse: false,
            errorText: null,
            errorCode: null,
            showError: false,
            isError: false,
        },
        items: [{kind: "part", index: 0, part: {type: "text", text: id}}],
        precededByEmptyAssistant: false,
        hidden: false,
        ...over,
    }) as TurnViewModel

describe("mergeAssistantRuns", () => {
    it("folds consecutive assistant turns into one keyed by the first, carrying the last's state", () => {
        const merged = mergeAssistantRuns([
            turn("u1", true),
            turn("a1", false),
            turn("a2", false, {isStreamingTurn: true, isLast: true, traceId: "t2"}),
        ])
        expect(merged.map((t) => t.message.id)).toEqual(["u1", "a1"])
        const run = merged[1]
        expect(run.items).toHaveLength(2)
        expect(new Set(run.items.map((i) => i.index)).size).toBe(2)
        expect(run.isStreamingTurn).toBe(true)
        expect(run.isLast).toBe(true)
        expect(run.traceId).toBe("t2")
        expect(run.message.parts).toHaveLength(2)
    })

    it("drops the copy of earlier parts a later message briefly carries", () => {
        const call = {type: "tool-bash", toolCallId: "c1", state: "output-available"}
        const merged = mergeAssistantRuns([
            turn("u1", true),
            turn("a1", false, {
                items: [
                    {kind: "part", index: 0, part: {type: "text", text: "thinking"}},
                    {kind: "tools", index: 1, parts: [call]},
                ],
            } as Partial<TurnViewModel>),
            turn("a2", false, {
                items: [
                    {kind: "part", index: 0, part: {type: "text", text: "thinking"}},
                    {kind: "tools", index: 1, parts: [call]},
                    {kind: "part", index: 2, part: {type: "text", text: "next"}},
                ],
            } as Partial<TurnViewModel>),
        ])
        const texts = merged[1].items.map((i) =>
            i.kind === "part" ? (i.part as {text?: string}).text : i.kind,
        )
        expect(texts).toEqual(["thinking", "tools", "next"])
    })

    it("leaves a lone assistant turn untouched, by identity", () => {
        const a = turn("a1", false)
        expect(mergeAssistantRuns([turn("u1", true), a])[1]).toBe(a)
    })
})
