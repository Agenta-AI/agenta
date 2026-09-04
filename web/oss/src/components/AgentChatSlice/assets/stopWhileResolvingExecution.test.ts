import {describe, expect, it, vi} from "vitest"

import {createStopPendingGate} from "./stopWhileResolvingExecution"

describe("createStopPendingGate", () => {
    it("starts the local abort while the execution snapshot is still loading", async () => {
        const gate = createStopPendingGate()
        let resolveSnapshot!: (executionId: string) => void
        const snapshot = new Promise<string>((resolve) => {
            resolveSnapshot = resolve
        })
        const events: string[] = []
        const stop = vi.fn(() => events.push("stop"))
        const cancelExecution = vi.fn(async (executionId: string | undefined) => {
            events.push(`cancel:${executionId}`)
        })

        const stopping = gate.stopWhileResolvingExecution({
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

    it("holds turn B until the snapshot pins cancellation to turn A", async () => {
        const gate = createStopPendingGate()
        let releaseSnapshot!: () => void
        const snapshotHeld = new Promise<void>((resolve) => {
            releaseSnapshot = resolve
        })
        let finishCancel!: () => void
        const cancelHeld = new Promise<void>((resolve) => {
            finishCancel = resolve
        })
        let currentExecutionId = "turn-A"
        const events: string[] = []

        const stopping = gate.stopWhileResolvingExecution({
            stop: () => events.push("stop"),
            resolveExecutionId: async () => {
                events.push("snapshot:start")
                await snapshotHeld
                events.push(`snapshot:${currentExecutionId}`)
                return currentExecutionId
            },
            cancelExecution: async (executionId) => {
                events.push(`cancel:${executionId}`)
                await cancelHeld
            },
        })
        const admittingTurnB = gate.runAfterPendingStop(async () => {
            currentExecutionId = "turn-B"
            events.push("admit:turn-B")
        })

        await Promise.resolve()
        expect(currentExecutionId).toBe("turn-A")
        expect(events).toEqual(["snapshot:start", "stop"])

        releaseSnapshot()
        await admittingTurnB

        expect(events).toEqual([
            "snapshot:start",
            "stop",
            "snapshot:turn-A",
            "cancel:turn-A",
            "admit:turn-B",
        ])
        expect(currentExecutionId).toBe("turn-B")

        finishCancel()
        await stopping
    })
})
