import {describe, expect, it} from "vitest"

import {cancelledStopAction} from "../../src/features/chat/stopHereState"

type StopInput = Parameters<typeof cancelledStopAction>[0]

const idleRun: StopInput = {
    parkedAtRequest: false,
    parkedAtResponse: false,
    streaming: false,
    retry: false,
    executionState: "stopping",
}

describe("mobile local Stop state", () => {
    it.each([
        {
            name: "settles a parked approval as soon as the server confirms cancellation",
            input: {parkedAtRequest: true, parkedAtResponse: true},
            action: "settle-parked",
        },
        {
            name: "settles when a streaming run parks before cancellation returns",
            input: {parkedAtResponse: true},
            action: "settle-parked",
        },
        {
            name: "waits for terminal stream evidence after cancelling an active stream",
            input: {streaming: true},
            action: "await-terminal",
        },
        {
            name: "hard-aborts an active stream after the watchdog retry is accepted",
            input: {streaming: true, retry: true},
            action: "abort-retry",
        },
        {
            name: "keeps Stopping for a run not streamed here until the server reflects the stop",
            input: {},
            action: "await-server",
        },
        {
            name: "settles a run not streamed here once the server reports it idle",
            input: {executionState: "idle"},
            action: "settle-idle",
        },
        {
            name: "settles an acknowledged legacy Stop without waiting for the client deadline",
            input: {streaming: true, executionState: "idle"},
            action: "abort-settled",
        },
    ] satisfies {name: string; input: Partial<StopInput>; action: string}[])(
        "$name",
        ({input, action}) => {
            expect(cancelledStopAction({...idleRun, ...input})).toBe(action)
        },
    )
})
