import type {SessionRecord} from "@agenta/entities/session"
import {atom} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

// `fetchSessionRecordsAtom` (real impl in @agenta/entities) hits the network via
// jotai-tanstack-query; loadSessionMessages only needs its {records, refreshed} contract, so the
// atom is replaced with a controllable stub rather than standing up a query client + fetch mock.
let fetchResult: {records: SessionRecord[] | null; refreshed?: Promise<SessionRecord[] | null>}
vi.mock("@agenta/entities/session", () => ({
    fetchSessionRecordsAtom: atom(null, async () => fetchResult),
}))

const {loadSessionMessages} = await import("../../../src/assets/loadSession")

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

describe("loadSessionMessages", () => {
    beforeEach(() => {
        fetchResult = {records: null}
    })

    it("returns null when there are no records", async () => {
        fetchResult = {records: null}
        expect(await loadSessionMessages("session-1")).toBeNull()
    })

    it("returns null when the record log is empty", async () => {
        fetchResult = {records: []}
        expect(await loadSessionMessages("session-1")).toBeNull()
    })

    it("replays the fetched records through transcriptToMessages", async () => {
        fetchResult = {
            records: [record("r1", {type: "message", text: "hi"}), record("r2", {type: "done"})],
        }
        const messages = await loadSessionMessages("session-1")
        expect(messages).toHaveLength(1)
        expect(messages?.[0]).toMatchObject({parts: [{type: "text", text: "hi"}]})
    })

    it("delivers a refreshed transcript via onRefreshed once the background revalidation resolves", async () => {
        const fresh = [record("r3", {type: "message", text: "fresh"}), record("r4", {type: "done"})]
        fetchResult = {
            records: [record("r1", {type: "message", text: "stale"}), record("r2", {type: "done"})],
            refreshed: Promise.resolve(fresh),
        }
        const onRefreshed = vi.fn()
        await loadSessionMessages("session-1", onRefreshed)
        // `refreshed` resolves asynchronously after the function returns — flush microtasks.
        await Promise.resolve()
        await Promise.resolve()
        expect(onRefreshed).toHaveBeenCalledTimes(1)
        const delivered = onRefreshed.mock.calls[0][0] as {parts: unknown}[]
        expect(delivered[0]).toMatchObject({parts: [{type: "text", text: "fresh"}]})
    })

    // The chain outlives the call, so the function's own try/catch never sees a rejection here.
    it("survives a rejected background revalidation without an unhandled rejection", async () => {
        const unhandled = vi.fn()
        process.on("unhandledRejection", unhandled)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        try {
            fetchResult = {
                records: [
                    record("r1", {type: "message", text: "stale"}),
                    record("r2", {type: "done"}),
                ],
                refreshed: Promise.reject(new Error("boom")),
            }
            const onRefreshed = vi.fn()
            const messages = await loadSessionMessages("session-1", onRefreshed)
            await Promise.resolve()
            await Promise.resolve()
            // The restored transcript still stands; only the revalidation was lost.
            expect(messages?.[0]).toMatchObject({parts: [{type: "text", text: "stale"}]})
            expect(onRefreshed).not.toHaveBeenCalled()
            expect(warn).toHaveBeenCalled()
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(unhandled).not.toHaveBeenCalled()
        } finally {
            process.off("unhandledRejection", unhandled)
            warn.mockRestore()
        }
    })

    it("does not call onRefreshed when the background revalidation yields nothing new", async () => {
        fetchResult = {
            records: [record("r1", {type: "message", text: "stale"}), record("r2", {type: "done"})],
            refreshed: Promise.resolve(null),
        }
        const onRefreshed = vi.fn()
        await loadSessionMessages("session-1", onRefreshed)
        await Promise.resolve()
        await Promise.resolve()
        expect(onRefreshed).not.toHaveBeenCalled()
    })
})
