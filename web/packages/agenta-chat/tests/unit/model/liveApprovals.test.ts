import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {getLivePendingApprovals, getPendingApprovals} from "../../../src/model/approvals"
import approvalTurnFixture from "../fixtures/approvalTurn.json"

const messages = approvalTurnFixture as UIMessage[]

describe("getLivePendingApprovals", () => {
    it("returns the pending gates while the turn is live", () => {
        expect(getLivePendingApprovals(messages)).toEqual(getPendingApprovals(messages))
        expect(getLivePendingApprovals(messages, {stopped: false})).toEqual(
            getPendingApprovals(messages),
        )
        expect(getLivePendingApprovals(messages).length).toBeGreaterThan(0)
    })

    it("returns nothing once the user stopped the turn", () => {
        expect(getLivePendingApprovals(messages, {stopped: true})).toEqual([])
    })

    it("is empty for an empty transcript either way", () => {
        expect(getLivePendingApprovals([], {stopped: false})).toEqual([])
        expect(getLivePendingApprovals([], {stopped: true})).toEqual([])
    })
})
