/**
 * Which revision counts as "latest".
 *
 * This used to be decided by `created_at`, with `version` reachable only when every timestamp was
 * missing. Revisions an agent commits itself land in bursts that tie to the second, and the picker
 * compared with a strict `>`, so a tie kept whichever revision the API happened to return first —
 * an arbitrary one. The wrong answer then stuck: it is written to the `latestRevision` query key,
 * mirrored to IndexedDB, and that query is disabled whenever the key already holds a value, so
 * nothing ever revalidated it. The playground opened on a stale revision for good.
 *
 * `version` is server-assigned and monotonic. It decides; timestamps only break ties within a
 * version.
 */
import {describe, expect, it} from "vitest"

import {isLaterWorkflowRevision} from "../../src/workflow/state/store"

const rev = (version: number, created_at?: string | null) =>
    ({id: `r${version}`, version, created_at: created_at ?? null}) as never

describe("isLaterWorkflowRevision", () => {
    it("prefers the higher version even when the older one has a newer timestamp", () => {
        const v13 = rev(13, "2026-01-01T10:00:00Z")
        const v10 = rev(10, "2026-01-01T11:00:00Z")
        expect(isLaterWorkflowRevision(v13, v10)).toBe(true)
        expect(isLaterWorkflowRevision(v10, v13)).toBe(false)
    })

    it("does not let a timestamp tie decide by array order", () => {
        const sameInstant = "2026-01-01T10:00:00Z"
        expect(isLaterWorkflowRevision(rev(13, sameInstant), rev(12, sameInstant))).toBe(true)
        expect(isLaterWorkflowRevision(rev(12, sameInstant), rev(13, sameInstant))).toBe(false)
    })

    it("falls back to recency only when versions match", () => {
        expect(
            isLaterWorkflowRevision(rev(7, "2026-01-02T00:00:00Z"), rev(7, "2026-01-01T00:00:00Z")),
        ).toBe(true)
    })

    it("treats a missing incumbent as beatable and a missing candidate as not", () => {
        expect(isLaterWorkflowRevision(rev(1), null)).toBe(true)
        expect(isLaterWorkflowRevision(null, rev(1))).toBe(false)
    })
})
