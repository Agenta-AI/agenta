import {isComposerRunStoppable} from "@agenta/chat/assets"
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
            name: "renders activity without remote Stop for a ready reader",
            input: {livenessRunning: true, sharedReaderAdvertised: true, readerReady: true},
            expected: {showActivity: true, showRemoteStop: false},
        },
        {
            name: "renders activity and remote Stop while the reader reconnects",
            input: {livenessRunning: true, sharedReaderAdvertised: true, readerReady: false},
            expected: {showActivity: true, showRemoteStop: true},
        },
        {
            name: "renders activity and remote Stop when the reader is off",
            input: {livenessRunning: true, sharedReaderAdvertised: false, readerReady: false},
            expected: {showActivity: true, showRemoteStop: true},
        },
        {
            name: "renders activity without remote Stop for an owned continuation",
            input: {
                livenessRunning: true,
                sharedReaderAdvertised: true,
                readerReady: false,
                ownedContinuation: true,
            },
            expected: {showActivity: true, showRemoteStop: false},
        },
    ])("$name", ({input, expected}) => {
        expect(deriveMobileRemoteTurnPresentation(input)).toEqual(expected)
    })

    it("offers legacy remote Stop only while session-stream liveness is running", () => {
        const input = {
            snapshotRunning: true,
            sharedReaderAdvertised: false,
            readerReady: false,
        }

        expect(
            deriveMobileRemoteTurnPresentation({...input, livenessRunning: true}).showRemoteStop,
        ).toBe(true)
        expect(
            deriveMobileRemoteTurnPresentation({...input, livenessRunning: false}).showRemoteStop,
        ).toBe(false)
    })

    it("hides remote Stop when the advertised reader is ready", () => {
        expect(
            deriveMobileRemoteTurnPresentation({
                livenessRunning: true,
                sharedReaderAdvertised: true,
                readerReady: true,
            }).showRemoteStop,
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

    it("renders exactly one Stop for a flag-off remote run", () => {
        const stripStop = showRunningElsewhere({running: true, localStatus: "idle"})
        const composerStop = isComposerRunStoppable({
            localStreaming: false,
            serverBusy: true,
            serverControlEnabled: false,
            waitingOnUser: false,
        })

        expect([stripStop, composerStop].filter(Boolean)).toHaveLength(1)
        expect(stripStop).toBe(true)
        expect(composerStop).toBe(false)
    })
})
