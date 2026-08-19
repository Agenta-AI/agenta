/**
 * Unit tests for the schedule message <-> inputs_fields mapping.
 *
 * Chat agents store a `messages` array; completion agents store their schema's
 * primary string input. The composer edits one message and these helpers keep
 * the JSON in the right shape while preserving other keys.
 */

import {describe, expect, it} from "vitest"

import {
    getScheduleMessage,
    getScheduleMessagePreview,
    parseInputsFields,
    remapMessageShape,
    setScheduleMessage,
} from "../../src/gatewayTrigger/core/messageInputs"

describe("getScheduleMessage", () => {
    it("reads the user message from a chat messages array", () => {
        const json = JSON.stringify({messages: [{role: "user", content: "do the thing"}]})
        expect(getScheduleMessage(json, true, "messages")).toBe("do the thing")
    })

    it("reads the primary key for a completion agent", () => {
        expect(getScheduleMessage(JSON.stringify({query: "summarize"}), false, "query")).toBe(
            "summarize",
        )
    })

    // The bound agent may be unresolved (schema selectors report "completion" until it
    // loads) or the mapping written by the API — the payload's own shape decides.
    it("reads a messages payload even when the schema says completion", () => {
        const json = JSON.stringify({messages: [{role: "user", content: "publish an article"}]})
        expect(getScheduleMessage(json, false, "message")).toBe("publish an article")
    })

    it("returns empty string when absent or unparseable", () => {
        expect(getScheduleMessage("{}", true, "messages")).toBe("")
        expect(getScheduleMessage("{}", false, "query")).toBe("")
        expect(getScheduleMessage("not json", false, "query")).toBe("")
    })

    it("returns empty for non-reproducible chat payloads (multi/non-user/non-string)", () => {
        const j = (v: unknown) => JSON.stringify(v)
        expect(
            getScheduleMessage(
                j({
                    messages: [
                        {role: "user", content: "a"},
                        {role: "user", content: "b"},
                    ],
                }),
                true,
                "messages",
            ),
        ).toBe("")
        expect(
            getScheduleMessage(
                j({messages: [{role: "assistant", content: "a"}]}),
                true,
                "messages",
            ),
        ).toBe("")
        expect(
            getScheduleMessage(
                j({messages: [{role: "user", content: [{type: "text", text: "a"}]}]}),
                true,
                "messages",
            ),
        ).toBe("")
    })
})

describe("parseInputsFields", () => {
    it("accepts a non-array object", () => {
        expect(parseInputsFields('{"context":"$"}')).toEqual({value: {context: "$"}})
    })

    it("treats empty as {}", () => {
        expect(parseInputsFields("   ")).toEqual({value: {}})
    })

    it("rejects arrays, primitives, and invalid JSON", () => {
        expect(parseInputsFields("[]").error).toBeTruthy()
        expect(parseInputsFields('"hi"').error).toBeTruthy()
        expect(parseInputsFields("5").error).toBeTruthy()
        expect(parseInputsFields("{not json").error).toBeTruthy()
    })
})

describe("setScheduleMessage", () => {
    it("writes a chat message as a messages array", () => {
        const out = setScheduleMessage("{}", "hello", true, "messages")
        expect(JSON.parse(out)).toEqual({messages: [{role: "user", content: "hello"}]})
    })

    it("writes a completion message under the primary key", () => {
        expect(JSON.parse(setScheduleMessage("{}", "hi", false, "query"))).toEqual({query: "hi"})
    })

    it("preserves other keys set via raw JSON", () => {
        const json = JSON.stringify({query: "old", context: "keep me"})
        expect(JSON.parse(setScheduleMessage(json, "new", false, "query"))).toEqual({
            query: "new",
            context: "keep me",
        })
    })

    // Must mirror the getter, or editing a messages payload under a completion schema
    // would strand the original and add a stray `message` key.
    it("writes back into messages when that is where the getter read from", () => {
        const json = JSON.stringify({messages: [{role: "user", content: "old"}]})
        expect(JSON.parse(setScheduleMessage(json, "new", false, "message"))).toEqual({
            messages: [{role: "user", content: "new"}],
        })
    })

    it("removes the key and collapses to {} when cleared", () => {
        expect(setScheduleMessage(JSON.stringify({query: "x"}), "  ", false, "query")).toBe("{}")
        expect(setScheduleMessage(JSON.stringify({messages: [{}]}), "", true, "messages")).toBe(
            "{}",
        )
    })

    it("round-trips through get/set", () => {
        const set = setScheduleMessage("{}", "round trip", true, "messages")
        expect(getScheduleMessage(set, true, "messages")).toBe("round trip")
    })
})

describe("getScheduleMessagePreview", () => {
    it("reads a chat user message without a schema", () => {
        expect(getScheduleMessagePreview({messages: [{role: "user", content: "do it"}]})).toBe(
            "do it",
        )
    })

    it("falls back to the first non-empty string value", () => {
        expect(getScheduleMessagePreview({count: 3, query: "summarize", other: ""})).toBe(
            "summarize",
        )
    })

    it("returns empty string when nothing is present", () => {
        expect(getScheduleMessagePreview({})).toBe("")
        expect(getScheduleMessagePreview(null)).toBe("")
    })
})

// The drawers resolve the bound agent asynchronously, so a message can be typed under a
// placeholder shape ("completion" / "message") and only then learn the agent is chat.
describe("remapMessageShape", () => {
    const completion = {isChat: false, primaryKey: "message"}
    const chat = {isChat: true, primaryKey: "messages"}

    it("moves a completion message into the chat shape", () => {
        const before = JSON.stringify({message: "summarize this"})
        const after = JSON.parse(remapMessageShape(before, completion, chat))
        expect(after).toEqual({messages: [{role: "user", content: "summarize this"}]})
    })

    it("moves a chat message into the completion shape", () => {
        const before = JSON.stringify({messages: [{role: "user", content: "summarize this"}]})
        const after = JSON.parse(
            remapMessageShape(before, chat, {isChat: false, primaryKey: "query"}),
        )
        expect(after).toEqual({query: "summarize this"})
    })

    it("renames between two completion inputs", () => {
        const before = JSON.stringify({message: "hello"})
        const after = JSON.parse(
            remapMessageShape(before, completion, {isChat: false, primaryKey: "query"}),
        )
        expect(after).toEqual({query: "hello"})
    })

    // The whole point of the helper: never leave the message under both keys.
    it("drops the old shape's key rather than writing both", () => {
        const after = JSON.parse(
            remapMessageShape(JSON.stringify({message: "x"}), completion, chat),
        )
        expect(after).not.toHaveProperty("message")
    })

    it("preserves sibling keys", () => {
        const before = JSON.stringify({message: "x", event: "$.event.attributes"})
        const after = JSON.parse(remapMessageShape(before, completion, chat))
        expect(after.event).toBe("$.event.attributes")
        expect(after.messages).toEqual([{role: "user", content: "x"}])
    })

    // A mapping the composer can't read has nothing safe to move — leave it exactly as it was.
    it("returns unreadable mappings untouched", () => {
        const richer = JSON.stringify({context: "$"})
        expect(remapMessageShape(richer, completion, chat)).toBe(richer)
        expect(remapMessageShape("", completion, chat)).toBe("")
        expect(remapMessageShape("not json", completion, chat)).toBe("not json")
    })

    it("is a no-op in value when the shape did not actually change", () => {
        const before = JSON.stringify({message: "x"})
        expect(JSON.parse(remapMessageShape(before, completion, completion))).toEqual({
            message: "x",
        })
    })
})
