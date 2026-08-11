import {beforeEach, describe, expect, it, vi} from "vitest"

const fernQuerySessions = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({querySessions: fernQuerySessions}),
    getLowPrioritySessionsClient: () => ({querySessions: fernQuerySessions}),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {querySessions, querySessionsPage} from "../../src/session/api/api"

const row = {
    id: "session-row-1",
    project_id: "project-1",
    session_id: "session-1",
}

beforeEach(() => {
    fernQuerySessions.mockReset()
    fernQuerySessions.mockResolvedValue({count: 1, sessions: [row]})
})

describe("querySessionsPage", () => {
    it("sends the exact canonical nested Fern request", async () => {
        await querySessionsPage({
            projectId: "project-1",
            session: {
                search: "refund",
                liveness: {is_alive: true},
                origins: ["trigger"],
            },
            sessionIds: ["session-1"],
            exclude: {sessionIds: ["session-pinned"], origins: ["manual"]},
            turnReferences: [{id: "agent-1"}],
            includeEnded: true,
            includeArchived: false,
            includeTotal: true,
            expand: ["last_message", "trigger"],
            windowing: {
                limit: 30,
                next: "session-row-0",
                oldest: "2026-08-10T10:00:00Z",
                order: "ascending",
            },
        })

        expect(fernQuerySessions).toHaveBeenCalledTimes(1)
        const [request, options] = fernQuerySessions.mock.calls[0]
        expect(request).toEqual({
            session: {
                search: "refund",
                liveness: {is_alive: true},
                origins: ["trigger"],
            },
            session_ids: ["session-1"],
            exclude: {session_ids: ["session-pinned"], origins: ["manual"]},
            turn_references: [{id: "agent-1"}],
            include_ended: true,
            include_archived: false,
            include_total: true,
            expand: ["last_message", "trigger"],
            windowing: {
                limit: 30,
                next: "session-row-0",
                oldest: "2026-08-10T10:00:00Z",
                order: "ascending",
            },
        })
        expect(request).not.toHaveProperty("references")
        expect(request).not.toHaveProperty("search")
        expect(request).not.toHaveProperty("flags")
        expect(request).not.toHaveProperty("origin")
        expect(request).not.toHaveProperty("exclude_origin")
        expect(options).toEqual({
            queryParams: {project_id: "project-1"},
            abortSignal: undefined,
        })
    })

    it("leaves canonical lifecycle fields unset so the server applies its defaults", async () => {
        await querySessionsPage({projectId: "project-1"})

        const request = fernQuerySessions.mock.calls[0][0]
        expect(request.include_ended).toBeUndefined()
        expect(request.include_archived).toBeUndefined()
    })

    it("adapts querySessions flat options without sending compatibility fields", async () => {
        const result = await querySessions({
            projectId: "project-1",
            search: "legacy",
            flags: {is_running: true},
            origin: "manual",
            excludeSessionIds: ["session-2"],
            excludeOrigin: "trigger",
            references: [{slug: "agent"}],
            limit: 10,
            newest: "2026-08-10T12:00:00Z",
        })

        expect(fernQuerySessions.mock.calls[0][0]).toMatchObject({
            session: {
                search: "legacy",
                liveness: {is_running: true},
                origins: ["manual"],
            },
            exclude: {session_ids: ["session-2"], origins: ["trigger"]},
            turn_references: [{slug: "agent"}],
            include_ended: true,
            include_archived: true,
            windowing: {limit: 10, newest: "2026-08-10T12:00:00Z"},
        })
        const request = fernQuerySessions.mock.calls[0][0]
        expect(request).not.toHaveProperty("references")
        expect(request).not.toHaveProperty("search")
        expect(request).not.toHaveProperty("flags")
        expect(request).not.toHaveProperty("origin")
        expect(request).not.toHaveProperty("exclude_origin")
        expect(result).toEqual([row])
    })
})
