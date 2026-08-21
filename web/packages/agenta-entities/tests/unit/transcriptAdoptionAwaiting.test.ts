import {describe, expect, it} from "vitest"

import {shouldAdoptServerTranscript} from "../../src/session/core/transcriptAdoption"
import {hasWaitingInteraction} from "../../src/session/state/interactionStatus"
import type {SessionInteractionRowState} from "../../src/session/state/interactionStatus"

const row = (status: SessionInteractionRowState["status"]): SessionInteractionRowState => ({
    token: "t1",
    status,
    kind: "client_tool" as SessionInteractionRowState["kind"],
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
