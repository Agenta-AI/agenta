import assert from "node:assert/strict"

import {
    extractChatMessages,
    getBeautifiedJsonEntries,
    selectPreviewChatMessages,
} from "@agenta/ui/cell-renderers"

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
    const stringified = JSON.stringify([
        {
            role: "user",
            content: [
                {type: "text", text: "what is this picture"},
                {
                    type: "image_url",
                    image_url: {url: "data:image/jpeg;base64,AAAA", detail: "auto"},
                },
            ],
        },
    ])

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

    assert.deepEqual(extractChatMessages(choices), [{role: "assistant", content: "from choices"}])
    assert.deepEqual(extractChatMessages(single), [{role: "assistant", content: "single message"}])
    assert.equal(extractChatMessages(plainJson), null)
    assert.deepEqual(extractChatMessages(stringified), JSON.parse(stringified))

    assert.deepEqual(getBeautifiedJsonEntries({context: "you are a helpful chat bot"}), [
        {key: "context", value: "you are a helpful chat bot"},
    ])
    assert.equal(getBeautifiedJsonEntries({}), null)
    assert.equal(getBeautifiedJsonEntries([{context: "not a record"}]), null)

    const previewMessages = [
        {role: "user", content: "hi"},
        {role: "assistant", content: "Hello"},
        {role: "user", content: "who invented you"},
    ]
    assert.deepEqual(selectPreviewChatMessages(previewMessages, {strategy: "last-user"}), {
        selected: [{role: "user", content: "who invented you"}],
        totalCount: 3,
    })
    assert.deepEqual(selectPreviewChatMessages(previewMessages, {maxTotalLines: 2}), {
        selected: [{role: "user", content: "hi"}],
        totalCount: 3,
    })

    console.log("extractChatMessages tests passed")
}

run()
