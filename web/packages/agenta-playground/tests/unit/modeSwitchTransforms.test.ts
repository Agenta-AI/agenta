/**
 * Unit tests for the mode switch transforms.
 *
 * The contract under test (docs/design/playground-mode-switch/):
 * - splitting moves only a trailing assistant reply to the output slot
 * - conversations ending in user/tool messages freeze whole
 * - round-trip with no edits is identity, in both directions
 * - the transforms never invent, drop, or reorder turns
 */
import {describe, expect, it} from "vitest"

import {
    mergeConversationFromCompletion,
    normalizeColumnMessages,
    splitConversationForCompletion,
    type ColumnMessage,
} from "../../src/state/helpers/modeSwitchTransforms"

const sys: ColumnMessage = {role: "system", content: "You are a support bot."}
const u1: ColumnMessage = {role: "user", content: "Where is my order?"}
const a1: ColumnMessage = {role: "assistant", content: "Let me check that for you."}
const u2: ColumnMessage = {role: "user", content: "Thanks."}
const a2: ColumnMessage = {role: "assistant", content: "It ships tomorrow."}
const toolCall: ColumnMessage = {
    role: "assistant",
    content: null,
    tool_calls: [{id: "c1", type: "function", function: {name: "lookup", arguments: "{}"}}],
}
const toolResult: ColumnMessage = {role: "tool", content: "order #42: shipped", tool_call_id: "c1"}

describe("splitConversationForCompletion", () => {
    it("moves the trailing assistant reply to the output slot", () => {
        const {history, lastOutput} = splitConversationForCompletion([u1, a1, u2, a2])
        expect(history).toEqual([u1, a1, u2])
        expect(lastOutput).toEqual(a2)
    })

    it("freezes a typed-but-unrun user turn into history with no output", () => {
        const {history, lastOutput} = splitConversationForCompletion([u1, a1, u2])
        expect(history).toEqual([u1, a1, u2])
        expect(lastOutput).toBeUndefined()
    })

    it("treats a trailing tool exchange as history, not output", () => {
        const {history, lastOutput} = splitConversationForCompletion([u1, toolCall, toolResult])
        expect(history).toEqual([u1, toolCall, toolResult])
        expect(lastOutput).toBeUndefined()
    })

    it("handles the empty conversation", () => {
        expect(splitConversationForCompletion([])).toEqual({history: []})
    })

    it("keeps a data system message in history (it is user data, not the template)", () => {
        const {history, lastOutput} = splitConversationForCompletion([sys, u1, a1])
        expect(history).toEqual([sys, u1])
        expect(lastOutput).toEqual(a1)
    })

    it("does not mutate its input", () => {
        const input = [u1, a1]
        splitConversationForCompletion(input)
        expect(input).toEqual([u1, a1])
    })
})

describe("mergeConversationFromCompletion", () => {
    it("appends the latest output as the final assistant turn", () => {
        expect(mergeConversationFromCompletion([u1, a1, u2], a2)).toEqual([u1, a1, u2, a2])
    })

    it("opens history as-is when there is no output yet", () => {
        expect(mergeConversationFromCompletion([u1, a1, u2], null)).toEqual([u1, a1, u2])
        expect(mergeConversationFromCompletion([u1, a1, u2])).toEqual([u1, a1, u2])
    })

    it("turns a variables-only row into an empty conversation", () => {
        expect(mergeConversationFromCompletion([], null)).toEqual([])
    })
})

describe("round trips", () => {
    it("chat -> completion -> chat is identity", () => {
        const conversation = [sys, u1, a1, u2, a2]
        const {history, lastOutput} = splitConversationForCompletion(conversation)
        expect(mergeConversationFromCompletion(history, lastOutput)).toEqual(conversation)
    })

    it("completion -> chat -> completion is identity", () => {
        const history = [u1, a1, u2]
        const conversation = mergeConversationFromCompletion(history, a2)
        expect(splitConversationForCompletion(conversation)).toEqual({history, lastOutput: a2})
    })

    it("repeated round trips do not duplicate or lose turns", () => {
        let conversation = [u1, a1]
        for (let i = 0; i < 3; i++) {
            const {history, lastOutput} = splitConversationForCompletion(conversation)
            conversation = mergeConversationFromCompletion(history, lastOutput)
        }
        expect(conversation).toEqual([u1, a1])
    })
})

describe("normalizeColumnMessages", () => {
    it("passes arrays through and filters non-messages", () => {
        expect(normalizeColumnMessages([u1, "noise", {no: "role"}, a1])).toEqual([u1, a1])
    })

    it("parses stringified columns", () => {
        expect(normalizeColumnMessages(JSON.stringify([u1, a1]))).toEqual([u1, a1])
    })

    it("returns [] for malformed input", () => {
        expect(normalizeColumnMessages("{not json")).toEqual([])
        expect(normalizeColumnMessages({role: "user"})).toEqual([])
        expect(normalizeColumnMessages(undefined)).toEqual([])
    })
})
