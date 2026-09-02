/**
 * A stopped turn shows no live approval card.
 *
 * Stop cancels the stopped turn's interactions server-side, so an approve or deny pressed after a
 * Stop answers a turn that no longer exists (#6315). Replay reaches the same conclusion from the
 * stored rows; this rule is the live path reaching it without waiting for a refetch. Both the
 * desktop (`AgentConversation`) and the mobile chat (`LiveConversation`) read it from here, so the
 * two cannot disagree.
 */
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
