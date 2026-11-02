/**
 * A turn start and a turn settle both invalidate the rail's session queries. The rail's paging
 * tail re-reads every page it has loaded, one request per page, so a prefix match on
 * `sidebar-sessions` turned one lifecycle event into up to twelve requests. The matcher has to
 * hit the head window and skip the tail.
 */
import {describe, expect, it} from "vitest"

import {isSidebarSessionHeadQuery} from "@/features/chat/useSessionWatch"

const PROJECT = "project-1"

/** The head key, as `sessionsSource` builds it. */
const headKey = ["sidebar-sessions", PROJECT, [] as string[], "all", "7d", "chat", null] as const

/** The tail key. Same prefix, with the slot that tells them apart in position two. */
const tailKey = [
    "sidebar-sessions",
    PROJECT,
    "older",
    [] as string[],
    "all",
    "7d",
    "chat",
    null,
    3,
    null,
] as const

describe("isSidebarSessionHeadQuery", () => {
    it("matches the head window", () => {
        expect(isSidebarSessionHeadQuery(headKey)).toBe(true)
    })

    it("skips the paging tail", () => {
        expect(isSidebarSessionHeadQuery(tailKey)).toBe(false)
    })

    it("matches a head window under any facet, since only the tail marks that slot", () => {
        expect(
            isSidebarSessionHeadQuery([
                "sidebar-sessions",
                PROJECT,
                ["agent-1"],
                "waiting",
                "24h",
                "automation",
                ["session-1"],
            ]),
        ).toBe(true)
    })

    it("leaves the rail's other query families alone", () => {
        expect(isSidebarSessionHeadQuery(["sidebar-sessions-pinned", PROJECT])).toBe(false)
        expect(isSidebarSessionHeadQuery(["sidebar-sessions-waiting", PROJECT])).toBe(false)
    })
})
