import {describe, expect, it} from "vitest"

import type {Workflow} from "../../src/workflow/core/schema"
import {byMostRecentlyUpdated} from "../../src/workflow/state/store"

const wf = (id: string, updated_at?: string, created_at?: string) =>
    ({id, updated_at, created_at}) as unknown as Workflow

describe("prompt list order", () => {
    // The sidebar shows the first five; an unordered list skipped the prompts just edited.
    it("puts the most recently updated prompt first, created time as the fallback", () => {
        const list = [
            wf("old", "2026-01-01T00:00:00Z"),
            wf("new", "2026-11-01T00:00:00Z"),
            wf("created-only", undefined, "2026-06-01T00:00:00Z"),
            wf("none"),
        ]
        expect([...list].sort(byMostRecentlyUpdated).map((w) => w.id)).toEqual([
            "new",
            "created-only",
            "old",
            "none",
        ])
    })
})
