import {describe, expect, it} from "vitest"

import {shouldAdoptServerTranscript} from "../../src/session/core/transcriptAdoption"
import {hasWaitingInteraction} from "../../src/session/state/interactionStatus"
import type {SessionInteractionRowState} from "../../src/session/state/interactionStatus"

const row = (status: SessionInteractionRowState["status"]): SessionInteractionRowState => ({
    token: "t1",
    status,
    kind: "client_tool" as SessionInteractionRowState["kind"],
})

/** The shape the sessions API returns for a Terminal call parked on Approve/Deny. */
const pendingApprovalRow = (): SessionInteractionRowState => ({
    token: "0199a1e2-approval-token",
    status: "pending",
    kind: "user_approval" as SessionInteractionRowState["kind"],
    toolCallId: "toolu_01Terminal",
})

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

    it("reads a pending row as waiting and terminal rows as settled", () => {
        expect(hasWaitingInteraction(new Map([["t1", row("pending")]]))).toBe(true)
        expect(hasWaitingInteraction(new Map([["t1", row("responded")]]))).toBe(false)
        expect(hasWaitingInteraction(new Map([["t1", row("resolved")]]))).toBe(false)
        expect(hasWaitingInteraction(new Map([["t1", row("cancelled")]]))).toBe(false)
    })

    it("treats absent rows as not waiting — the guard needs positive evidence", () => {
        expect(hasWaitingInteraction(undefined)).toBe(false)
        expect(hasWaitingInteraction(new Map())).toBe(false)
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

    const rows = new Map([["0199a1e2-approval-token", pendingApprovalRow()]])

    it("sees the pending user_approval row as waiting on the user", () => {
        expect(hasWaitingInteraction(rows)).toBe(true)
    })

    it("adopts the server transcript even though an approval is pending", () => {
        expect(
            shouldAdoptServerTranscript({...coldOpen, awaitingUser: hasWaitingInteraction(rows)}),
        ).toBe(true)
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
                awaitingUser: hasWaitingInteraction(rows),
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
