import {describe, expect, it, vi} from "vitest"

import {stopWhileResolvingExecution} from "./stopWhileResolvingExecution"

describe("stopWhileResolvingExecution", () => {
    it("starts the local abort while the execution snapshot is still loading", async () => {
        let resolveSnapshot!: (executionId: string) => void
        const snapshot = new Promise<string>((resolve) => {
            resolveSnapshot = resolve
        })
        const events: string[] = []
        const stop = vi.fn(() => events.push("stop"))
        const cancelExecution = vi.fn(async (executionId: string | undefined) => {
            events.push(`cancel:${executionId}`)
        })

        const stopping = stopWhileResolvingExecution({
            stop,
            resolveExecutionId: () => {
                events.push("snapshot:start")
                return snapshot
            },
            cancelExecution,
        })

        expect(events).toEqual(["snapshot:start", "stop"])
        expect(cancelExecution).not.toHaveBeenCalled()

        resolveSnapshot("turn-A")
        await stopping

        expect(events).toEqual(["snapshot:start", "stop", "cancel:turn-A"])
        expect(cancelExecution).toHaveBeenCalledWith("turn-A")
    })
})
