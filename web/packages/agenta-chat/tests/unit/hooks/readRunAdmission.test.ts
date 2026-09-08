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
        await expect(readRunAdmission(streamOf([accepted("turn-4").trimEnd()]), w)).resolves.toBe(
            true,
        )
        expect(w.onAccepted).toHaveBeenCalledWith("turn-4")
    })

    it("reads a final REFUSAL with no trailing newline", async () => {
        // The trailing-frame rescan used to throw away an error verdict, so the same refusal
        // reported nothing without a newline and onFailed with one.
        const w = watcher()
        const frame = `data: ${JSON.stringify({type: "error", errorText: "refused"})}`
        await expect(readRunAdmission(streamOf([frame]), w)).resolves.toBe(false)
        expect(w.onFailed).toHaveBeenCalledTimes(1)
    })

    it("reports whether the turn was named, which is what gates settlement", async () => {
        const ok = watcher()
        await expect(readRunAdmission(streamOf([accepted("turn-7")]), ok)).resolves.toBe(true)
        const silent = watcher()
        await expect(
            readRunAdmission(streamOf(['data: {"type":"start"}\n']), silent),
        ).resolves.toBe(false)
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

    // An ordinary request never gets an acceptance frame, so `start` is the only thing that says
    // the turn began. Live evidence on the EE dev stack: a run whose model call failed 13 s in
    // ("no credits remaining") was read as a refused send, which put a second copy of the
    // delivered message on screen under "Message wasn't sent".
    it("does not read a mid-run failure as a refused send", async () => {
        const w = watcher()
        const result = await readRunAdmission(
            streamOf([
                'data: {"type":"start","messageId":"a1"}\n',
                'data: {"type":"start-step"}\n',
                'data: {"type":"text-delta","id":"t1","delta":"partial"}\n',
                'data: {"type":"data-agent-error","data":{"code":"runner_error","errorText":"no credits"}}\n',
                'data: {"type":"error","errorText":"no credits"}\n',
                'data: {"type":"finish"}\n',
            ]),
            w,
        )
        expect(w.onFailed).not.toHaveBeenCalled()
        expect(result).toBe(false)
    })

    it("still reads an error before the turn begins as a refusal", async () => {
        const w = watcher()
        await readRunAdmission(streamOf(['data: {"type":"error","errorText":"refused"}\n']), w)
        expect(w.onFailed).toHaveBeenCalledTimes(1)
    })

    it("still names the turn when acceptance follows the answer's first frame", async () => {
        // The runner emits `start` BEFORE `data-session-accepted`, so scanning has to continue
        // past a start frame or a detached send would lose the id it retires on.
        const w = watcher()
        const result = await readRunAdmission(
            streamOf([
                'data: {"type":"start","messageId":"a1"}\n',
                'data: {"type":"start-step"}\n',
                accepted("turn-9"),
                'data: {"type":"finish"}\n',
            ]),
            w,
        )
        expect(w.onAccepted).toHaveBeenCalledWith("turn-9")
        expect(w.onFailed).not.toHaveBeenCalled()
        expect(result).toBe(true)
    })

    it("does not read a failure after acceptance as a refused send", async () => {
        const w = watcher()
        await readRunAdmission(
            streamOf([accepted("turn-10"), 'data: {"type":"error","errorText":"ran out"}\n']),
            w,
        )
        expect(w.onFailed).not.toHaveBeenCalled()
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
