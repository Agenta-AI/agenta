import {describe, expect, it} from "vitest"

import type {ReleaseEntry} from "../../src/releases"
import {computeUnseenReleases} from "../../src/releases/seen"

const release = (id: string): ReleaseEntry => ({id, title: id, description: id})

describe("computeUnseenReleases", () => {
    const shipped = [release("c"), release("b"), release("a")]

    it("shows nothing on the first visit (nothing stored yet)", () => {
        expect(computeUnseenReleases({releases: shipped, seenIds: null})).toEqual([])
    })

    it("shows only what shipped after the seen set", () => {
        expect(computeUnseenReleases({releases: shipped, seenIds: ["b", "a"]})).toEqual([
            release("c"),
        ])
    })

    it("shows nothing when everything is seen", () => {
        expect(computeUnseenReleases({releases: shipped, seenIds: ["c", "b", "a"]})).toEqual([])
    })

    it("handles a curated (not date-sorted) list: position does not decide newness", () => {
        // "mid" is inserted between seen entries — a pointer model would hide it.
        const curated = [release("b"), release("mid"), release("a")]
        expect(computeUnseenReleases({releases: curated, seenIds: ["b", "a"]})).toEqual([
            release("mid"),
        ])
    })
})
