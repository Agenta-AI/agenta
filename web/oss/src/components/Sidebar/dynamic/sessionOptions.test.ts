import {sessionListPolicies} from "@agenta/sessions/state"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {fernQuerySessions} = vi.hoisted(() => ({fernQuerySessions: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({querySessions: fernQuerySessions}),
    getLowPrioritySessionsClient: () => ({querySessions: fernQuerySessions}),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {
    SIDEBAR_SESSION_LIMIT,
    SIDEBAR_SESSION_VISIBLE_LIMIT,
    sidebarSessionFilters,
    sidebarSessionOptions,
} from "./sessionOptions"

beforeEach(() => {
    fernQuerySessions.mockReset()
    fernQuerySessions.mockResolvedValue({count: 0, sessions: []})
})

describe("sidebarSessionFilters", () => {
    it("excludes pinned ids from the recent request before pagination", () => {
        const pinnedIds = Array.from({length: 100}, (_, index) => `pin-${index}`)

        expect(
            sidebarSessionFilters({projectId: "project-1", excludeSessionIds: pinnedIds}),
        ).toEqual({
            projectId: "project-1",
            includeArchived: false,
            sessionIds: undefined,
            excludeSessionIds: pinnedIds,
            limit: SIDEBAR_SESSION_LIMIT,
            lowPriority: true,
            origins: undefined,
            excludeOrigins: ["trigger"],
            expand: [],
        })
    })

    // Count must exceed the sidebar window, else the default limit alone would satisfy this.
    it("widens the explicit id group to cover every pinned row", () => {
        const pinCount = SIDEBAR_SESSION_LIMIT + 50
        const pinnedIds = Array.from({length: pinCount}, (_, index) => `pin-${index}`)
        expect(sidebarSessionFilters({projectId: "project-1", sessionIds: pinnedIds}).limit).toBe(
            pinCount,
        )
    })

    // A pin is an explicit user request and overrides the sidebar's origin filter — a pinned
    // automation session must still show (P2-8). It also carries the `trigger` expansion so a
    // pinned automation row's name resolves even though the sidebar's own policy never requests
    // it (without this, the row falls back to "Missing schedule").
    it("drops the exclude-trigger filter and requests the trigger expansion for the pinned request", () => {
        const pinnedIds = ["pin-1", "pin-2"]
        expect(
            sidebarSessionFilters({
                projectId: "project-1",
                sessionIds: pinnedIds,
                policy: sessionListPolicies.sidebarPinned,
            }),
        ).toEqual({
            projectId: "project-1",
            includeArchived: false,
            sessionIds: pinnedIds,
            excludeSessionIds: undefined,
            limit: SIDEBAR_SESSION_LIMIT,
            lowPriority: true,
            origins: undefined,
            excludeOrigins: undefined,
            expand: ["trigger"],
        })
    })

    // The request window exists to survive the unstarted rows dropped before render, so it has to
    // stay comfortably wider than what the group actually shows.
    it("requests a window far wider than the rows the group renders", () => {
        expect(SIDEBAR_SESSION_VISIBLE_LIMIT).toBe(14)
        expect(SIDEBAR_SESSION_LIMIT).toBeGreaterThan(SIDEBAR_SESSION_VISIBLE_LIMIT * 2)
    })

    it("sends pinned exclusions in the canonical recent request", async () => {
        const pinnedIds = ["pin-1", "pin-2"]
        const options = sidebarSessionOptions({
            projectId: "project-1",
            excludeSessionIds: pinnedIds,
        })

        await options.queryFn({pageParam: null})

        expect(fernQuerySessions.mock.calls[0][0]).toEqual({
            session: {search: undefined, liveness: undefined, origins: undefined},
            session_ids: undefined,
            exclude: {session_ids: pinnedIds, origins: ["trigger"]},
            turn_references: undefined,
            include_ended: true,
            include_archived: false,
            include_total: false,
            expand: [],
            windowing: {
                limit: SIDEBAR_SESSION_LIMIT,
                next: undefined,
                newest: undefined,
                oldest: undefined,
                order: "descending",
            },
        })
    })
})
