// @vitest-environment jsdom
import {describe, expect, it, vi} from "vitest"

import {parkedInputIdFromBody, readRunAdmission} from "../../../src/hooks/useServerSessionInputs"

const streamOf = (chunks: string[], fail?: Error): Response => {
    let index = 0
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index >= chunks.length) {
                if (fail) controller.error(fail)
                else controller.close()
                return
            }
            controller.enqueue(new TextEncoder().encode(chunks[index++]))
        },
    })
    return new Response(body, {status: 200})
}

const accepted = (id: string) =>
    `data: ${JSON.stringify({type: "data-session-accepted", data: {executionId: id}})}\n`

const watcher = () => ({
    onAccepted: vi.fn(),
    onParked: vi.fn(),
    onFailed: vi.fn(),
})

describe("readRunAdmission", () => {
    it("reports the accepted turn id", async () => {
        const w = watcher()
        await readRunAdmission(streamOf([accepted("turn-1"), "data: {}\n"]), w)
        expect(w.onAccepted).toHaveBeenCalledWith("turn-1")
        expect(w.onFailed).not.toHaveBeenCalled()
    })

    it("reads an acceptance split across chunk boundaries", async () => {
        const w = watcher()
        const frame = accepted("turn-2")
        const chunks = frame.split("").map((c) => c)
        await readRunAdmission(streamOf(chunks), w)
        expect(w.onAccepted).toHaveBeenCalledWith("turn-2")
    })

    it("reads CRLF and CR-only framing", async () => {
        for (const eol of ["\r\n", "\r"]) {
            const w = watcher()
            const frame = accepted("turn-3").replace("\n", eol)
            await readRunAdmission(streamOf([frame, `data: {}${eol}`]), w)
            expect(w.onAccepted).toHaveBeenCalledWith("turn-3")
        }
    })

    it("reads a final frame with no trailing newline", async () => {
        const w = watcher()
        await readRunAdmission(streamOf([accepted("turn-4").trimEnd()]), w)
        expect(w.onAccepted).toHaveBeenCalledWith("turn-4")
    })

    it("reports failure for an error frame before acceptance", async () => {
        const w = watcher()
        await readRunAdmission(
            streamOf([`data: ${JSON.stringify({type: "error", errorText: "refused"})}\n`]),
            w,
        )
        expect(w.onFailed).toHaveBeenCalledTimes(1)
        expect(w.onAccepted).not.toHaveBeenCalled()
    })

    it("does NOT report failure for an ordinary stream that never accepts", async () => {
        // The runner emits the acceptance frame only for a detached request, so silence is the
        // normal case for an ordinary send. Calling it a failure would flag good turns.
        const w = watcher()
        await readRunAdmission(
            streamOf([
                'data: {"type":"start"}\n',
                'data: {"type":"message-metadata","messageMetadata":{"turnId":"turn-5"}}\n',
            ]),
            w,
        )
        expect(w.onFailed).not.toHaveBeenCalled()
        expect(w.onAccepted).not.toHaveBeenCalled()
    })

    it("stays silent when the connection drops, before or after acceptance", async () => {
        const before = watcher()
        await readRunAdmission(streamOf(['data: {"type":"start"}\n'], new Error("boom")), before)
        expect(before.onFailed).not.toHaveBeenCalled()

        const after = watcher()
        await readRunAdmission(streamOf([accepted("turn-6")], new Error("boom")), after)
        expect(after.onAccepted).toHaveBeenCalledWith("turn-6")
        expect(after.onFailed).not.toHaveBeenCalled()
    })

    it("reports failure when there is no body to read", async () => {
        const w = watcher()
        await readRunAdmission(new Response(null, {status: 200}), w)
        expect(w.onFailed).toHaveBeenCalledTimes(1)
    })
})

describe("parkedInputIdFromBody", () => {
    it("reads the durable input id a 202 names", () => {
        expect(parkedInputIdFromBody({action: "pending", input: {id: "input-1"}})).toBe("input-1")
    })

    it("returns null for anything else", () => {
        expect(parkedInputIdFromBody(null)).toBeNull()
        expect(parkedInputIdFromBody({action: "pending"})).toBeNull()
        expect(parkedInputIdFromBody({input: {}})).toBeNull()
        expect(parkedInputIdFromBody({input: {id: 7}})).toBeNull()
    })
})
