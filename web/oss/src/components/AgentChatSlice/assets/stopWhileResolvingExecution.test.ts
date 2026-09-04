import {act, createElement, useCallback} from "react"

import {latestTurnId} from "@agenta/chat/assets"
import {clearSessionTurnId, getSessionTurnId, setSessionTurnId} from "@agenta/chat/state"
import type {UIMessage} from "ai"
import {createRoot} from "react-dom/client"
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vitest"

import {stopPinnedExecution} from "./stopWhileResolvingExecution"

const sessionId = "session-1"

const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
        resolve = done
    })
    return {promise, resolve}
}

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true))
afterAll(() => vi.unstubAllGlobals())
afterEach(() => clearSessionTurnId(sessionId))

describe("stopPinnedExecution", () => {
    it("starts the local abort while cancellation is still pending", async () => {
        const held = deferred()
        const events: string[] = []
        const stop = vi.fn(() => events.push("stop"))
        const cancelExecution = vi.fn(async (executionId: string | undefined) => {
            events.push(`cancel:${executionId}`)
            await held.promise
        })

        const stopping = stopPinnedExecution({
            stop,
            expectedExecutionId: "turn-A",
            cancelExecution,
        })

        expect(events).toEqual(["stop", "cancel:turn-A"])

        held.resolve()
        await stopping
        expect(cancelExecution).toHaveBeenCalledWith("turn-A")
    })

    it("stops turn B before metadata without restoring turn A's id", async () => {
        const stop = vi.fn()
        const cancelExecution = vi.fn(async (_executionId: string | undefined) => {})
        setSessionTurnId(sessionId, "turn-A")

        clearSessionTurnId(sessionId)
        const messages = [
            {id: "a1", role: "assistant", parts: [], metadata: {turnId: "turn-A"}},
            {id: "u2", role: "user", parts: []},
        ] as UIMessage[]
        const turnId = latestTurnId(messages)
        if (turnId) setSessionTurnId(sessionId, turnId)

        await stopPinnedExecution({
            stop,
            expectedExecutionId: getSessionTurnId(sessionId),
            cancelExecution,
        })

        expect(stop).toHaveBeenCalledOnce()
        expect(cancelExecution).toHaveBeenCalledWith(undefined)
        expect(cancelExecution).not.toHaveBeenCalledWith("turn-A")
    })

    it("keeps turn A pinned when turn B is admitted while cancellation is held", async () => {
        const held = deferred()
        const cancelled: (string | undefined)[] = []
        setSessionTurnId(sessionId, "turn-A")

        const stopping = stopPinnedExecution({
            stop: vi.fn(),
            expectedExecutionId: getSessionTurnId(sessionId),
            cancelExecution: async (executionId) => {
                await held.promise
                cancelled.push(executionId)
            },
        })

        clearSessionTurnId(sessionId)
        setSessionTurnId(sessionId, "turn-B")
        expect(getSessionTurnId(sessionId)).toBe("turn-B")

        held.resolve()
        await stopping
        expect(cancelled).toEqual(["turn-A"])
    })

    it("keeps turn A pinned after the hook remounts and admits turn B", async () => {
        const held = deferred()
        const cancelled: (string | undefined)[] = []
        const cancelExecution = async (executionId: string | undefined) => {
            await held.promise
            cancelled.push(executionId)
        }
        let stopFromMount!: () => Promise<void>
        const Harness = () => {
            stopFromMount = useCallback(
                () =>
                    stopPinnedExecution({
                        stop: vi.fn(),
                        expectedExecutionId: getSessionTurnId(sessionId),
                        cancelExecution,
                    }),
                [],
            )
            return null
        }

        const mount = () => {
            const host = document.createElement("div")
            const root = createRoot(host)
            act(() => root.render(createElement(Harness)))
            return root
        }

        setSessionTurnId(sessionId, "turn-A")
        const firstMount = mount()
        let stopping!: Promise<void>
        act(() => {
            stopping = stopFromMount()
        })
        act(() => firstMount.unmount())

        clearSessionTurnId(sessionId)
        setSessionTurnId(sessionId, "turn-B")
        const secondMount = mount()
        expect(getSessionTurnId(sessionId)).toBe("turn-B")

        held.resolve()
        await stopping
        expect(cancelled).toEqual(["turn-A"])
        act(() => secondMount.unmount())
    })
})
