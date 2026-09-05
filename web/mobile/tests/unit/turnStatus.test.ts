import {describe, expect, it} from "vitest"

import {
    deriveMobileRemoteTurnPresentation,
    showTrailingWorkingPulse,
} from "@/features/chat/turnStatus"

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

describe("deriveMobileRemoteTurnPresentation", () => {
    it.each([
        {
            name: "renders activity and no strip for a ready reader",
            input: {running: true, sharedReaderAdvertised: true, readerReady: true},
            expected: {showActivity: true, showStrip: false},
        },
        {
            name: "renders the strip while the reader is not ready",
            input: {running: true, sharedReaderAdvertised: true, readerReady: false},
            expected: {showActivity: false, showStrip: true},
        },
        {
            name: "renders the strip when the feature is off",
            input: {running: true, sharedReaderAdvertised: false, readerReady: false},
            expected: {showActivity: false, showStrip: true},
        },
        {
            name: "does not render the strip in the tab that owns a continuation",
            input: {
                running: true,
                sharedReaderAdvertised: true,
                readerReady: false,
                ownedContinuation: true,
            },
            expected: {showActivity: false, showStrip: false},
        },
    ])("$name", ({input, expected}) => {
        expect(deriveMobileRemoteTurnPresentation(input)).toEqual(expected)
    })
})
