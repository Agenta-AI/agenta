/**
 * Unit test for `shouldSkipRecordsRefresh` — the guard that stops the records-changed relay from
 * clobbering a client-tool settle that hasn't resumed yet.
 *
 * Regression: clicking "Not now" on a parked connect request fired zero network requests and the
 * interaction stayed `pending` forever (live evidence: sessions e8c3b72a-0fb0-4895-a77d-3f073672da8a
 * and 9d4e0324-344c-42f0-ab72-a7afe0246b72 on the 8180 dev stack — reproduced live: clicking "Not
 * now" produced no new `/services/agent/v0/invoke` request, and the transcript visibly reverted to
 * an earlier turn). Root cause: `useSessionRecordsWatch`'s relay can tick and adopt a server
 * transcript while the run is idle (`busy=false`, since the resume hasn't been dispatched yet) but a
 * local `addToolOutput` settle is still waiting for `sendAutomaticallyWhen` to fire — the adopted
 * transcript predates the settle and silently discards it.
 */
import {type UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {hasStrandedTail, shouldSkipRecordsRefresh} from "./useSessionHydration"

describe("shouldSkipRecordsRefresh", () => {
    it("does not skip when idle and no settle is pending a resume", () => {
        expect(shouldSkipRecordsRefresh({busy: false, pendingResume: false})).toBe(false)
    })

    it("skips while this tab is streaming (existing busy guard)", () => {
        expect(shouldSkipRecordsRefresh({busy: true, pendingResume: false})).toBe(true)
    })

    it("skips while a client-tool settle awaits its resume dispatch, even though busy=false", () => {
        // This is the exact gap the bug lived in: not busy yet, but not safe to adopt either.
        expect(shouldSkipRecordsRefresh({busy: false, pendingResume: true})).toBe(true)
    })

    it("skips when both are true", () => {
        expect(shouldSkipRecordsRefresh({busy: true, pendingResume: true})).toBe(true)
    })
})

describe("hasStrandedTail", () => {
    const user = {id: "u1", role: "user", parts: []} as unknown as UIMessage
    const assistant = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage

    it("flags a transcript ending in an unanswered user turn", () => {
        expect(hasStrandedTail([user])).toBe(true)
        expect(hasStrandedTail([assistant, user])).toBe(true)
    })

    it("passes a transcript whose tail was answered (or error-stamped)", () => {
        expect(hasStrandedTail([user, assistant])).toBe(false)
    })

    it("passes an empty transcript", () => {
        expect(hasStrandedTail([])).toBe(false)
    })
})
