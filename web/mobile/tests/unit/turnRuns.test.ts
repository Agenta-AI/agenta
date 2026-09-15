import type {TurnViewModel} from "@agenta/chat/model"
import {describe, expect, it} from "vitest"

import {mergeAssistantRuns} from "@/features/chat/turnRuns"
import {isFirstResponse} from "@/features/chat/turnStatus"

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

    it("keeps only the new call of a tool group that echoes an earlier one beside it", () => {
        const c1 = {type: "tool-bash", toolCallId: "c1", state: "output-available"}
        const c2 = {type: "tool-read", toolCallId: "c2", state: "output-available"}
        const merged = mergeAssistantRuns([
            turn("u1", true),
            turn("a1", false, {
                items: [{kind: "tools", index: 0, parts: [c1]}],
                message: {id: "a1", role: "assistant", parts: [c1]},
            } as Partial<TurnViewModel>),
            turn("a2", false, {
                items: [{kind: "tools", index: 0, parts: [c1, c2]}],
                message: {id: "a2", role: "assistant", parts: [c1, c2]},
            } as Partial<TurnViewModel>),
        ])
        const calls = merged[1].items.flatMap((i) =>
            i.kind === "tools" ? i.parts.map((p) => p.toolCallId) : [],
        )
        expect(calls).toEqual(["c1", "c2"])
        expect(merged[1].message.parts.map((p) => (p as {toolCallId?: string}).toolCallId)).toEqual(
            ["c1", "c2"],
        )
    })

    it("keeps a thought the model genuinely repeats later in the run", () => {
        const say = (text: string) =>
            ({
                items: [{kind: "part", index: 0, part: {type: "reasoning", text}}],
                message: {id: "x", role: "assistant", parts: [{type: "reasoning", text}]},
            }) as Partial<TurnViewModel>
        const merged = mergeAssistantRuns([
            turn("u1", true),
            turn("a1", false, say("Let me check.")),
            turn("a2", false, say("Let me check.")),
            turn("a3", false, say("Let me check.")),
        ])
        // a2 echoes a1 and is dropped; a3 echoes nothing a2 kept, so it stands.
        expect(merged[1].items).toHaveLength(2)
        expect(merged[1].message.parts).toHaveLength(2)
    })

    it("leaves a lone assistant turn untouched, by identity", () => {
        const a = turn("a1", false)
        expect(mergeAssistantRuns([turn("u1", true), a])[1]).toBe(a)
    })
})

describe("isFirstResponse", () => {
    it("is true until a response exists, for the placeholder too", () => {
        const u = {isUser: true}
        const a = {isUser: false}
        expect(isFirstResponse([u], 1)).toBe(true)
        expect(isFirstResponse([u, a], 1)).toBe(true)
        expect(isFirstResponse([u, a, u], 3)).toBe(false)
        expect(isFirstResponse([u, a, u, a], 3)).toBe(false)
    })
})
