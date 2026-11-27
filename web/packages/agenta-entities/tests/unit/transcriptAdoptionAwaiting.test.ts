import {describe, expect, it} from "vitest"

import {shouldAdoptServerTranscript} from "../../src/session/core/transcriptAdoption"

const grown = {
    serverRecordCount: 10,
    serverMessageCount: 4,
    localMessageCount: 4,
    watermark: 5,
    busy: false,
}

describe("#5942 adoption guard", () => {
    it("adopts a grown log when nothing is waiting on the user", () => {
        expect(shouldAdoptServerTranscript({...grown, awaitingUser: false})).toBe(true)
    })

    it("refuses to adopt over a card still parked on the user", () => {
        expect(shouldAdoptServerTranscript({...grown, awaitingUser: true})).toBe(false)
    })
})

/**
 * A session parked on an approval opened EMPTY on a browser that never ran it: the guard above
 * refused the server transcript, nothing else calls `setMessages`, and the pane painted its
 * "start a chat" hero over a session the log has turns for — with no way to answer the approval
 * the user was told was waiting on them. The guard protects a rendered transcript, so with
 * nothing rendered it must not fire.
 */
describe("cold open of a session parked on an approval", () => {
    const coldOpen = {
        serverRecordCount: 12,
        serverMessageCount: 4,
        // Nothing on screen: this browser never ran the session, so there is no cached transcript.
        localMessageCount: 0,
        // Never server-derived here, so no watermark to compare against.
        watermark: undefined,
        busy: false,
    }

    it("adopts the server transcript even though an approval is pending", () => {
        expect(shouldAdoptServerTranscript({...coldOpen, awaitingUser: true})).toBe(true)
    })

    it("still refuses once that transcript is on screen — #5942 is intact", () => {
        // The same session one commit later: hydration adopted, so the parked card now renders
        // and its half-typed form is the thing the guard exists to protect.
        expect(
            shouldAdoptServerTranscript({
                ...coldOpen,
                localMessageCount: 4,
                watermark: 12,
                serverRecordCount: 14,
                awaitingUser: true,
            }),
        ).toBe(false)
    })

    it("keeps every other refusal — an empty transcript is not a bypass", () => {
        // `localMessageCount: 0` must not turn the guard into a blanket "always adopt".
        expect(shouldAdoptServerTranscript({...coldOpen, busy: true, awaitingUser: true})).toBe(
            false,
        )
        expect(
            shouldAdoptServerTranscript({...coldOpen, serverMessageCount: 0, awaitingUser: true}),
        ).toBe(false)
        expect(shouldAdoptServerTranscript({...coldOpen, watermark: 12, awaitingUser: true})).toBe(
            false,
        )
    })
})
