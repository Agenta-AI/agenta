import {describe, expect, it} from "vitest"

import {
    deriveMobileRemoteTurnPresentation,
    showRunningElsewhere,
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
            input: {livenessRunning: true, sharedReaderAdvertised: true, readerReady: true},
            expected: {showActivity: true, showStrip: false},
        },
        {
            name: "renders the strip while the reader is not ready",
            input: {livenessRunning: true, sharedReaderAdvertised: true, readerReady: false},
            expected: {showActivity: false, showStrip: true},
        },
        {
            name: "renders the strip when the feature is off",
            input: {livenessRunning: true, sharedReaderAdvertised: false, readerReady: false},
            expected: {showActivity: false, showStrip: true},
        },
        {
            name: "does not render the strip in the tab that owns a continuation",
            input: {
                livenessRunning: true,
                sharedReaderAdvertised: true,
                readerReady: false,
                ownedContinuation: true,
            },
            expected: {showActivity: false, showStrip: false},
        },
    ])("$name", ({input, expected}) => {
        expect(deriveMobileRemoteTurnPresentation(input)).toEqual(expected)
    })

    it("shows the flag-off observer banner only while session-stream liveness is running", () => {
        const input = {
            snapshotRunning: true,
            sharedReaderAdvertised: false,
            readerReady: false,
        }

        expect(
            deriveMobileRemoteTurnPresentation({...input, livenessRunning: true}).showStrip,
        ).toBe(true)
        expect(
            deriveMobileRemoteTurnPresentation({...input, livenessRunning: false}).showStrip,
        ).toBe(false)
    })

    it("hides the banner when the advertised reader is ready", () => {
        expect(
            deriveMobileRemoteTurnPresentation({
                livenessRunning: true,
                sharedReaderAdvertised: true,
                readerReady: true,
            }).showStrip,
        ).toBe(false)
    })
})

describe("showRunningElsewhere", () => {
    it("hides the strip for the tab that owns a detached continuation", () => {
        expect(showRunningElsewhere({running: true, localStatus: "running"})).toBe(false)
    })

    it("shows the strip for an idle observer of the same backend run", () => {
        expect(showRunningElsewhere({running: true, localStatus: "idle"})).toBe(true)
    })

    it("keeps a locally parked gate from being labeled remote", () => {
        expect(showRunningElsewhere({running: true, localStatus: "awaiting"})).toBe(false)
    })
})
