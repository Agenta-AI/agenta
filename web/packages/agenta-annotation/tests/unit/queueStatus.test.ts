import {describe, expect, it} from "vitest"

import {displayQueueStatus} from "../../src/state/queueLabels"

describe("displayQueueStatus", () => {
    it("is unknown until the queue's items load, so the badge never flips", () => {
        expect(displayQueueStatus({derived: "running", progress: null})).toBeNull()
    })

    it("reads Pending for an empty queue, whatever the stored status says", () => {
        expect(displayQueueStatus({derived: "running", progress: {completed: 0, total: 0}})).toBe(
            "pending",
        )
    })

    it("uses the status derived from the items once they load", () => {
        expect(displayQueueStatus({derived: "success", progress: {completed: 2, total: 2}})).toBe(
            "success",
        )
        expect(displayQueueStatus({derived: null, progress: {completed: 0, total: 2}})).toBe(
            "pending",
        )
    })
})
