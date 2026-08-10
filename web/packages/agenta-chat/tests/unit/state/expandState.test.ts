import type {UIMessage} from "ai"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    errorKey,
    expandedKeysForMessages,
    expandedValueAtomFamily,
    pruneExpandedAtom,
    reasoningKey,
    setExpandedAtom,
    toolGroupKey,
    toolRowKey,
} from "../../../src/state/expandState"

describe("expandState key builders", () => {
    it("builds a reasoning key from the message id and part index", () => {
        expect(reasoningKey("m1", 2)).toBe("m1::reason::2")
    })

    it("builds an error key from the message id", () => {
        expect(errorKey("m1")).toBe("m1::error")
    })

    it("builds a tool row key from the tool call id", () => {
        expect(toolRowKey("tool-1")).toBe("tool::row::tool-1")
    })

    it("builds a tool group key from the tool call id", () => {
        expect(toolGroupKey("tool-1")).toBe("tool::group::tool-1")
    })
})

describe("expandedKeysForMessages", () => {
    it("emits an error key for every message plus reasoning/tool keys for their parts", () => {
        const messages = [
            {
                id: "m1",
                role: "assistant",
                parts: [
                    {type: "reasoning", text: "thinking"},
                    {type: "tool-bash", toolCallId: "tool-1", state: "output-available"},
                    {type: "dynamic-tool", toolCallId: "tool-2", state: "output-available"},
                    {type: "text", text: "hi"},
                ],
            },
        ] as unknown as UIMessage[]

        const keys = expandedKeysForMessages(messages)
        expect(keys).toEqual(
            new Set([
                errorKey("m1"),
                reasoningKey("m1", 0),
                toolRowKey("tool-1"),
                toolGroupKey("tool-1"),
                toolRowKey("tool-2"),
                toolGroupKey("tool-2"),
            ]),
        )
    })

    it("skips a tool part with no toolCallId", () => {
        const messages = [
            {id: "m1", role: "assistant", parts: [{type: "tool-bash", state: "input-available"}]},
        ] as unknown as UIMessage[]
        expect(expandedKeysForMessages(messages)).toEqual(new Set([errorKey("m1")]))
    })
})

describe("setExpandedAtom / pruneExpandedAtom", () => {
    it("sets and reads a widget's expanded state through the scoped selector", () => {
        const store = createStore()
        store.set(setExpandedAtom, {key: reasoningKey("m1", 0), value: true})
        expect(store.get(expandedValueAtomFamily(reasoningKey("m1", 0)))).toBe(true)
    })

    it("prunes map entries whose key isn't in the live set", () => {
        const store = createStore()
        store.set(setExpandedAtom, {key: errorKey("m1"), value: true})
        store.set(setExpandedAtom, {key: errorKey("m2"), value: true})

        store.set(pruneExpandedAtom, new Set([errorKey("m1")]))

        expect(store.get(expandedValueAtomFamily(errorKey("m1")))).toBe(true)
        expect(store.get(expandedValueAtomFamily(errorKey("m2")))).toBeUndefined()
    })

    it("removes the pruned key's cached selector atom from the family", () => {
        const store = createStore()
        store.set(setExpandedAtom, {key: errorKey("m1"), value: true})
        expect(expandedValueAtomFamily.getParams()).toContain(errorKey("m1"))

        store.set(pruneExpandedAtom, new Set())

        expect(expandedValueAtomFamily.getParams()).not.toContain(errorKey("m1"))
    })
})
