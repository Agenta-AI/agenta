import {beforeEach, describe, expect, it, vi} from "vitest"

const {fernQuerySessions} = vi.hoisted(() => ({fernQuerySessions: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({querySessions: fernQuerySessions}),
    getLowPrioritySessionsClient: () => ({querySessions: fernQuerySessions}),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {sessionListPolicies} from "@/oss/lib/sessionListPolicies"

import {sidebarSessionFilters, sidebarSessionOptions} from "./sessionOptions"

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
            limit: 20,
            lowPriority: true,
            origins: undefined,
            excludeOrigins: ["trigger"],
            expand: [],
        })
    })

    it("requests all 100 pinned rows in the explicit id group", () => {
        const pinnedIds = Array.from({length: 100}, (_, index) => `pin-${index}`)
        expect(sidebarSessionFilters({projectId: "project-1", sessionIds: pinnedIds}).limit).toBe(
            100,
        )
    })

    // A pin is an explicit user request and overrides the sidebar's origin filter — a pinned
    // automation session must still show (P2-8).
    it("drops the exclude-trigger filter for the pinned request", () => {
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
            limit: 20,
            lowPriority: true,
            origins: undefined,
            excludeOrigins: undefined,
            expand: [],
        })
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
                limit: 20,
                next: undefined,
                newest: undefined,
                oldest: undefined,
                order: "descending",
            },
        })
    })
})
