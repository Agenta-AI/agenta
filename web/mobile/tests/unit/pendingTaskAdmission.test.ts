import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

import {
    pendingTasksAtom,
    sendPendingTaskAtom,
    stashPendingTaskAtom,
} from "../../src/features/home/pendingTask"

const task = {
    agentId: "agent",
    text: "keep this task",
    parts: [
        {
            type: "file" as const,
            url: "https://files.test/brief.pdf",
            mediaType: "application/pdf",
            filename: "brief.pdf",
        },
    ],
}

describe("mobile Home task admission", () => {
    it("retains failed text/files and retries only explicitly, clearing on success", async () => {
        const store = createStore()
        store.set(stashPendingTaskAtom, {sessionId: "one", task})
        const send = vi
            .fn()
            .mockRejectedValueOnce(new Error("capabilities unavailable"))
            .mockResolvedValueOnce(undefined)
        await store.set(sendPendingTaskAtom, {sessionId: "one", send})
        expect(store.get(pendingTasksAtom).one).toEqual({...task, delivery: "failed"})
        await store.set(sendPendingTaskAtom, {sessionId: "one", send})
        expect(send).toHaveBeenCalledOnce()
        await store.set(sendPendingTaskAtom, {sessionId: "one", send, retry: true})
        expect(send).toHaveBeenLastCalledWith({...task, delivery: "sending"})
        expect(store.get(pendingTasksAtom).one).toBeUndefined()
    })

    it("deduplicates concurrent mounts while admission is pending", async () => {
        const store = createStore()
        store.set(stashPendingTaskAtom, {sessionId: "one", task})
        let resolve!: () => void
        const send = vi.fn(
            () =>
                new Promise<void>((done) => {
                    resolve = done
                }),
        )
        const first = store.set(sendPendingTaskAtom, {sessionId: "one", send})
        await store.set(sendPendingTaskAtom, {sessionId: "one", send, retry: true})
        expect(send).toHaveBeenCalledOnce()
        resolve()
        await first
        expect(store.get(pendingTasksAtom).one).toBeUndefined()
    })

    it.each([false, true])(
        "does not overwrite a newer task or another session after old completion (failure=%s)",
        async (failure) => {
            const store = createStore()
            store.set(stashPendingTaskAtom, {sessionId: "one", task})
            let resolve!: () => void
            let reject!: (error: Error) => void
            const send = vi.fn(
                () =>
                    new Promise<void>((yes, no) => {
                        resolve = yes
                        reject = no
                    }),
            )
            const pending = store.set(sendPendingTaskAtom, {sessionId: "one", send})
            const newer = {...task, text: "newer"}
            store.set(stashPendingTaskAtom, {sessionId: "one", task: newer})
            store.set(stashPendingTaskAtom, {sessionId: "two", task})
            if (failure) reject(new Error("old failure"))
            else resolve()
            await pending
            expect(store.get(pendingTasksAtom)).toEqual({one: newer, two: task})
        },
    )
})
