import {describe, expect, it} from "vitest"

import {groupQueueItems, nextNeedsReviewId} from "../../src/state/nextNeedsReview"

const ids = ["a", "b", "c", "d", "e"]

describe("groupQueueItems", () => {
    it("splits the items by status and keeps the queue order in each group", () => {
        const groups = groupQueueItems(ids, {
            a: "success",
            b: "pending",
            c: "failure",
            d: "success",
            e: null,
        })
        expect(groups).toEqual({needsReview: ["b", "c", "e"], completed: ["a", "d"]})
    })

    it("puts an item with no status in Needs review", () => {
        expect(groupQueueItems(["x"], {})).toEqual({needsReview: ["x"], completed: []})
    })
})

describe("nextNeedsReviewId", () => {
    it("skips completed items after the current one", () => {
        const statuses = {a: "success", b: "success", c: "success", d: "pending", e: "pending"}
        expect(nextNeedsReviewId(ids, "b", statuses)).toBe("d")
    })

    it("goes back to the start when nothing after the current one needs review", () => {
        const statuses = {a: "success", b: "pending", c: "success", d: "success", e: "success"}
        expect(nextNeedsReviewId(ids, "d", statuses)).toBe("b")
    })

    it("never returns the current item, even when it is not completed yet", () => {
        const statuses = {a: "success", b: "success", c: "pending", d: "success", e: "success"}
        expect(nextNeedsReviewId(ids, "c", statuses)).toBeNull()
    })

    it("is null when every item is completed", () => {
        const statuses = Object.fromEntries(ids.map((id) => [id, "success"]))
        expect(nextNeedsReviewId(ids, "a", statuses)).toBeNull()
    })

    it("starts from the first item when there is no current one", () => {
        expect(nextNeedsReviewId(ids, null, {a: "success"})).toBe("b")
    })

    it("counts a failed item as one that needs review", () => {
        expect(nextNeedsReviewId(ids, "a", {a: "success", b: "failure"})).toBe("b")
    })
})
