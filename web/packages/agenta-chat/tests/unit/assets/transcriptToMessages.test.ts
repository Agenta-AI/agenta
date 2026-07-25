import type {SessionRecord} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {transcriptToMessages} from "../../../src/assets/transcriptToMessages"

const record = (id: string, payload: Record<string, unknown>, sender = "agent"): SessionRecord => ({
    id,
    session_id: "session-1",
    project_id: "project-1",
    event_index: null,
    sender,
    session_update: String(payload.type),
    payload,
    created_at: null,
})

describe("transcriptToMessages", () => {
    it("returns null for an empty transcript", () => {
        expect(transcriptToMessages([])).toBeNull()
    })

    it("returns null when records carry no renderable payload", () => {
        expect(transcriptToMessages([record("r1", {type: "done"})])).toBeNull()
    })

    it("splits assistant turns on a `done` boundary into separate messages", () => {
        const messages = transcriptToMessages([
            record("r1", {type: "message", text: "first turn"}),
            record("r2", {type: "done"}),
            record("r3", {type: "message", text: "second turn"}),
            record("r4", {type: "done"}),
        ])

        expect(messages).toHaveLength(2)
        expect(messages?.[0]).toMatchObject({
            id: "r1",
            role: "assistant",
            parts: [{type: "text", text: "first turn"}],
        })
        expect(messages?.[1]).toMatchObject({
            id: "r3",
            role: "assistant",
            parts: [{type: "text", text: "second turn"}],
        })
    })

    it("accumulates a streamed text turn from message_start/message_delta", () => {
        const messages = transcriptToMessages([
            record("r1", {type: "message_start", id: "text-1"}),
            record("r2", {type: "message_delta", id: "text-1", delta: "hel"}),
            record("r3", {type: "message_delta", id: "text-1", delta: "lo"}),
            record("r4", {type: "done"}),
        ])

        expect(messages).toHaveLength(1)
        expect(messages?.[0].parts).toEqual([{type: "text", text: "hello"}])
    })

    it("opens a new message when the sender role changes, even mid-turn", () => {
        const messages = transcriptToMessages([
            record("r1", {type: "message", text: "hi"}, "user"),
            record("r2", {type: "message", text: "hello back"}, "agent"),
        ])

        expect(messages).toHaveLength(2)
        expect(messages?.[0]).toMatchObject({role: "user"})
        expect(messages?.[1]).toMatchObject({role: "assistant"})
    })

    it("assembles a tool_call + tool_result pair into one settled tool part", () => {
        const messages = transcriptToMessages([
            record("r1", {
                type: "tool_call",
                id: "tool-1",
                name: "bash",
                input: {command: "ls"},
            }),
            record("r2", {type: "tool_result", id: "tool-1", output: "file.txt"}),
            record("r3", {type: "done"}),
        ])

        expect(messages).toHaveLength(1)
        expect(messages?.[0].parts).toEqual([
            {
                type: "tool-bash",
                toolCallId: "tool-1",
                state: "output-available",
                input: {command: "ls"},
                output: "file.txt",
            },
        ])
    })

    it("marks a tool call still awaiting its result as input-available", () => {
        const messages = transcriptToMessages([
            record("r1", {
                type: "tool_call",
                id: "tool-1",
                name: "search_docs",
                input: {query: "x"},
            }),
        ])

        expect(messages?.[0].parts).toEqual([
            {
                type: "tool-search_docs",
                toolCallId: "tool-1",
                state: "input-available",
                input: {query: "x"},
            },
        ])
    })

    it("marks a denied tool call as output-denied", () => {
        const messages = transcriptToMessages([
            record("r1", {type: "tool_call", id: "tool-1", name: "bash", input: {}}),
            record("r2", {type: "tool_result", id: "tool-1", denied: true}),
        ])

        expect(messages?.[0].parts[0]).toMatchObject({state: "output-denied"})
    })
})
