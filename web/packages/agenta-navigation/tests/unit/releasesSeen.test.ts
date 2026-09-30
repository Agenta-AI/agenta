import {describe, expect, it} from "vitest"

import type {ReleaseEntry} from "../../src/releases"
import {computeUnseenReleases, QUIET_PERIOD_MS} from "../../src/releases/seen"

const release = (id: string): ReleaseEntry => ({id, title: id, description: id})

const DAY = 24 * 60 * 60 * 1000

/** The push-surface scenarios from the 2026-09-30 feature-awareness research. */
describe("computeUnseenReleases", () => {
    const shipped = [release("c"), release("b"), release("a")]

    it("shows nothing on the first visit (nothing stored yet)", () => {
        expect(
            computeUnseenReleases({releases: shipped, seenIds: null, firstVisitAt: null, now: 0}),
        ).toEqual([])
    })

    it("shows nothing during the quiet period, even for a release shipped inside it", () => {
        const firstVisitAt = 0
        const seededSeen = ["b", "a"]
        const withNew = [release("new-during-quiet"), ...shipped.slice(1)]
        expect(
            computeUnseenReleases({
                releases: withNew,
                seenIds: seededSeen,
                firstVisitAt,
                now: firstVisitAt + QUIET_PERIOD_MS - 1,
            }),
        ).toEqual([])
    })

    it("surfaces the queued release once the quiet period ends", () => {
        const firstVisitAt = 0
        const withNew = [release("new-during-quiet"), release("b"), release("a")]
        expect(
            computeUnseenReleases({
                releases: withNew,
                seenIds: ["b", "a"],
                firstVisitAt,
                now: firstVisitAt + QUIET_PERIOD_MS,
            }),
        ).toEqual([release("new-during-quiet")])
    })

    it("shows an existing user only what shipped after their seen set", () => {
        expect(
            computeUnseenReleases({
                releases: shipped,
                seenIds: ["b", "a"],
                firstVisitAt: 0,
                now: 30 * DAY,
            }),
        ).toEqual([release("c")])
    })

    it("shows nothing when everything is seen", () => {
        expect(
            computeUnseenReleases({
                releases: shipped,
                seenIds: ["c", "b", "a"],
                firstVisitAt: 0,
                now: 30 * DAY,
            }),
        ).toEqual([])
    })

    it("handles a curated (not date-sorted) list: position does not decide newness", () => {
        // "mid" is inserted between seen entries — a pointer model would hide it.
        const curated = [release("b"), release("mid"), release("a")]
        expect(
            computeUnseenReleases({
                releases: curated,
                seenIds: ["b", "a"],
                firstVisitAt: 0,
                now: 30 * DAY,
            }),
        ).toEqual([release("mid")])
    })
})
