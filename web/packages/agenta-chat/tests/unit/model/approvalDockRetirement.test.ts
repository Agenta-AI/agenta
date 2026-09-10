/**
 * Increment-6 browser pass, round 8, item 3 — the desktop approval dock after a clean approve.
 *
 * The records below are the REAL durable record log of session
 * 973bfdbd-0226-477d-865a-479f4c3e3db1, ordered as `GET /sessions/records` returns them. The dock
 * is `open = getPendingApprovals(messages).length > 0`, so this replay is the whole retirement
 * contract: from the continuation's first record onward the gate must be gone.
 *
 * The round-8 report said the dock stayed open reading "Answered, waiting for the agent". The
 * screenshots taken at the same moment (evidence 41 and 47) show no dock at all. A closed
 * `HeightCollapse` keeps its latched card mounted at height 0 with `aria-hidden` and `inert`
 * (web/packages/agenta-ui/src/components/HeightCollapse.tsx), and `ApprovalDock` only resets its
 * `answered` flag when the current approval id changes — so a DOM or text read still finds the
 * stale eyebrow long after the dock has closed. This test pins the state that actually drives the
 * pixels, so the next round measures the same thing the user sees.
 */
import {describe, expect, it} from "vitest"

import {transcriptToMessages} from "../../../src/assets/transcriptToMessages"
import {getPendingApprovals} from "../../../src/model/approvals"

import records from "../assets/__fixtures__/approvalDockRetirement.records.json"

const APPROVAL_ID = "995951ee-bfec-4ef3-bd82-ea8bd0bbe313"
const AFTER_INTERACTION_REQUEST = 4
const AFTER_SOURCE_PAUSED_DONE = 5
const AFTER_CONTINUATION_FIRST_THOUGHT = 6

const pendingAfter = (count: number): string[] =>
    getPendingApprovals(
        (transcriptToMessages(records.slice(0, count) as never) ?? []) as never,
    ).map((approval) => approval.approvalId)

describe("the approval dock over a real durable continuation", () => {
    it("holds the gate while the source turn is parked", () => {
        expect(pendingAfter(AFTER_INTERACTION_REQUEST)).toEqual([APPROVAL_ID])
        expect(pendingAfter(AFTER_SOURCE_PAUSED_DONE)).toEqual([APPROVAL_ID])
    })

    it("retires the gate on the continuation's first record and never re-opens it", () => {
        for (let count = AFTER_CONTINUATION_FIRST_THOUGHT; count <= records.length; count += 1) {
            expect(pendingAfter(count), `record ${count}`).toEqual([])
        }
    })
})
