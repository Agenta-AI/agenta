import {describe, expect, it} from "vitest"

import {showTrailingWorkingPulse} from "@/features/chat/turnStatus"

const userTurn = {isUser: true, isStreamingTurn: false}
const streamingAssistant = {isUser: false, isStreamingTurn: true}
const settledAssistant = {isUser: false, isStreamingTurn: false}

describe("showTrailingWorkingPulse", () => {
    // The regression: a submitted request with only the user's message showed no progress at all.
    it("shows the pulse when the request is submitted and no assistant turn exists yet", () => {
        expect(showTrailingWorkingPulse(true, [userTurn])).toBe(true)
    })

    it("shows the pulse on the very first turn of an empty conversation", () => {
        expect(showTrailingWorkingPulse(true, [])).toBe(true)
    })

    it("defers to the streaming turn's own indicator once one exists", () => {
        expect(showTrailingWorkingPulse(true, [userTurn, streamingAssistant])).toBe(false)
    })

    it("shows nothing when the run is not active", () => {
        expect(showTrailingWorkingPulse(false, [userTurn, settledAssistant])).toBe(false)
        expect(showTrailingWorkingPulse(false, [])).toBe(false)
    })
})
