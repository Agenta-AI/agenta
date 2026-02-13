import assert from "node:assert/strict"

import {extractChatMessages} from "@agenta/ui/cell-renderers"

const run = () => {
    const validPrompt = {prompt: [{role: "user", content: "hi"}]}
    const nonChatPrompt = {prompt: [1, 2, 3]}
    const mixed = {
        inputs: {prompt: [{role: "user", content: "input side"}]},
        outputs: {completion: [{role: "assistant", content: "output side"}]},
    }
    const nested = {data: {inputs: {prompt: [{role: "user", content: "nested"}]}}}
    const deep = {a: {b: {c: {d: {prompt: [{role: "user", content: "too deep"}]}}}}}
    const choices = {choices: [{message: {role: "assistant", content: "from choices"}}]}
    const single = {role: "assistant", content: "single message"}
    const plainJson = {foo: "bar", count: 3}

    assert.deepEqual(extractChatMessages(validPrompt), [{role: "user", content: "hi"}])
    assert.equal(extractChatMessages(nonChatPrompt), null)

    assert.deepEqual(extractChatMessages(mixed, {prefer: "input"}), [
        {role: "user", content: "input side"},
    ])
    assert.deepEqual(extractChatMessages(mixed, {prefer: "output"}), [
        {role: "assistant", content: "output side"},
    ])
    assert.deepEqual(extractChatMessages({inputs: mixed.inputs}, {prefer: "output"}), [
        {role: "user", content: "input side"},
    ])

    assert.deepEqual(extractChatMessages(nested), [{role: "user", content: "nested"}])
    assert.equal(extractChatMessages(deep), null)

    assert.deepEqual(extractChatMessages(choices), [
        {role: "assistant", content: "from choices"},
    ])
    assert.deepEqual(extractChatMessages(single), [{role: "assistant", content: "single message"}])
    assert.equal(extractChatMessages(plainJson), null)

    console.log("extractChatMessages tests passed")
}

run()
