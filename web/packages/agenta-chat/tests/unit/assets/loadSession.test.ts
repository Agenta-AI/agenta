import type {SessionInteractionRowState, SessionRecord} from "@agenta/entities/session"
import {atom} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

// `fetchSessionRecordsAtom`/`fetchSessionInteractionStatesAtom` (real impls in @agenta/entities)
// hit the network via jotai-tanstack-query; loadSessionMessages only needs their resolved-value
// contracts, so both are replaced with controllable stubs rather than standing up a query client +
// fetch mock. The interaction-state map defaults empty — irrelevant to this file's own assertions,
// which only cover the records half; transcriptToMessages.test.ts covers the join itself.
let fetchResult: {records: SessionRecord[] | null; refreshed?: Promise<SessionRecord[] | null>}
let interactionRowStates = new Map<string, SessionInteractionRowState>()
vi.mock("@agenta/entities/session", () => ({
    fetchSessionRecordsAtom: atom(null, async () => fetchResult),
    fetchSessionInteractionStatesAtom: atom(null, async () => interactionRowStates),
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
        interactionRowStates = new Map()
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
        const transcript = await loadSessionMessages("session-1")
        expect(transcript?.messages).toHaveLength(1)
        expect(transcript?.messages[0]).toMatchObject({parts: [{type: "text", text: "hi"}]})
    })

    // The adoption watermark: records, not messages — a turn that grows in place keeps its
    // message count (issue #5530), so only this number sees the log move.
    it("reports how many records the transcript was built from", async () => {
        fetchResult = {
            records: [
                record("r1", {type: "message", text: "hi"}),
                record("r2", {type: "message", text: " there"}),
                record("r3", {type: "done"}),
            ],
        }
        const transcript = await loadSessionMessages("session-1")
        expect(transcript?.messages).toHaveLength(1)
        expect(transcript?.recordCount).toBe(3)
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
        const delivered = onRefreshed.mock.calls[0][0] as {
            messages: {parts: unknown}[]
            recordCount: number
        }
        expect(delivered.messages[0]).toMatchObject({parts: [{type: "text", text: "fresh"}]})
        // The refreshed delivery carries the FRESH log's count, not the stale one's.
        expect(delivered.recordCount).toBe(2)
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
            const transcript = await loadSessionMessages("session-1", onRefreshed)
            await Promise.resolve()
            await Promise.resolve()
            // The restored transcript still stands; only the revalidation was lost.
            expect(transcript?.messages[0]).toMatchObject({
                parts: [{type: "text", text: "stale"}],
            })
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
