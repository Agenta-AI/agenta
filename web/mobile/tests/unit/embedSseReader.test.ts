import {describe, expect, it} from "vitest"

import {readServerSentEvents, type ServerSentMessage} from "../../src/features/embed/sseReader"

const streamOf = (chunks: string[]) => {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
            controller.close()
        },
    })
}

const read = async (chunks: string[]) => {
    const messages: ServerSentMessage[] = []
    await readServerSentEvents(streamOf(chunks), (message) => messages.push(message))
    return messages
}

describe("readServerSentEvents", () => {
    it("names messages by their event field, and 'message' when there is none", async () => {
        expect(await read(['event: ready\ndata: {"watermark":3}\n\ndata: {"a":1}\n\n'])).toEqual([
            {event: "ready", data: '{"watermark":3}'},
            {event: "message", data: '{"a":1}'},
        ])
    })

    it("joins multi-line data and skips comments", async () => {
        expect(await read([": ping\n\ndata: one\ndata: two\n\n"])).toEqual([
            {event: "message", data: "one\ntwo"},
        ])
    })

    it("reassembles messages split across chunks, CRLF included", async () => {
        expect(
            await read(["data: hel", "lo\r", "\n\r\nevent: relay-close\r\ndata: {}\r\n\r\n"]),
        ).toEqual([
            {event: "message", data: "hello"},
            {event: "relay-close", data: "{}"},
        ])
    })

    it("keeps a character split across chunks whole", async () => {
        const bytes = new TextEncoder().encode("data: é\n\n")
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes.slice(0, 7))
                controller.enqueue(bytes.slice(7))
                controller.close()
            },
        })
        const messages: ServerSentMessage[] = []
        await readServerSentEvents(stream, (message) => messages.push(message))
        expect(messages).toEqual([{event: "message", data: "é"}])
    })

    it("drops a message the stream ended before finishing", async () => {
        expect(await read(["data: done\n\ndata: half"])).toEqual([{event: "message", data: "done"}])
    })
})
