import {beforeEach, describe, expect, it, vi} from "vitest"

const {querySessionsPage} = vi.hoisted(() => ({querySessionsPage: vi.fn()}))

vi.mock("../../src/session/api/api", () => ({querySessionsPage}))

import {nextSessionCursor, sessionListQueryOptions} from "../../src/session/state/listOptions"

const row = {
    id: "row-fallback",
    project_id: "project-1",
    session_id: "session-1",
    created_at: "2026-08-10T11:00:00Z",
    updated_at: "2026-08-10T12:00:00Z",
}

beforeEach(() => {
    querySessionsPage.mockReset()
})

describe("sessionListQueryOptions", () => {
    it("varies the key by expansion and origin policy", () => {
        const base = {projectId: "project-1"}
        const plain = sessionListQueryOptions(base).queryKey
        const expanded = sessionListQueryOptions({...base, expand: ["trigger"]}).queryKey
        const included = sessionListQueryOptions({...base, origins: ["trigger"]}).queryKey
        const excluded = sessionListQueryOptions({...base, excludeOrigins: ["trigger"]}).queryKey

        expect(expanded).not.toEqual(plain)
        expect(included).not.toEqual(plain)
        expect(excluded).not.toEqual(plain)
        expect(included).not.toEqual(excluded)
    })

    it("normalizes set-like key values into stable serializable order", () => {
        const first = sessionListQueryOptions({
            projectId: "project-1",
            origins: ["trigger", "manual"],
            excludeOrigins: ["trigger", "manual"],
            expand: ["trigger", "last_message"],
            sessionIds: ["b", "a"],
        }).queryKey
        const second = sessionListQueryOptions({
            projectId: "project-1",
            origins: ["manual", "trigger"],
            excludeOrigins: ["manual", "trigger"],
            expand: ["last_message", "trigger"],
            sessionIds: ["a", "b"],
        }).queryKey

        expect(first).toEqual(second)
    })

    it("passes canonical filters and cursor fields to the page API", async () => {
        querySessionsPage.mockResolvedValueOnce({count: 0, sessions: []})
        const options = sessionListQueryOptions({
            projectId: "project-1",
            search: "  refund  ",
            agentId: "agent-1",
            flags: {is_alive: true},
            origins: ["trigger"],
            excludeOrigins: ["manual"],
            expand: ["trigger"],
            order: "ascending",
        })

        await options.queryFn({
            pageParam: {
                next: "row-1",
                oldest: "2026-08-10T12:00:00Z",
                order: "ascending",
            },
        })

        expect(querySessionsPage).toHaveBeenCalledWith({
            projectId: "project-1",
            session: {
                search: "refund",
                liveness: {is_alive: true, is_running: undefined, is_attached: undefined},
                origins: ["trigger"],
            },
            turnReferences: [{id: "agent-1"}],
            includeArchived: false,
            includeEnded: true,
            includeTotal: false,
            expand: ["trigger"],
            sessionIds: undefined,
            exclude: {sessionIds: undefined, origins: ["manual"]},
            windowing: {
                limit: 30,
                next: "row-1",
                newest: undefined,
                oldest: "2026-08-10T12:00:00Z",
                order: "ascending",
            },
            abortSignal: undefined,
        })
    })
})

describe("nextSessionCursor", () => {
    it("prefers descending response windowing over row reconstruction", () => {
        expect(
            nextSessionCursor({
                count: 1,
                sessions: [row],
                windowing: {
                    next: "row-server",
                    newest: "2026-08-09T12:00:00Z",
                    limit: 1,
                    order: "descending",
                },
            }),
        ).toEqual({
            next: "row-server",
            newest: "2026-08-09T12:00:00Z",
            oldest: undefined,
            order: "descending",
        })
    })

    it("uses oldest for ascending response windowing", () => {
        expect(
            nextSessionCursor(
                {
                    count: 1,
                    sessions: [row],
                    windowing: {
                        next: "row-server",
                        oldest: "2026-08-11T12:00:00Z",
                        order: "ascending",
                    },
                },
                1,
                "ascending",
            ),
        ).toEqual({
            next: "row-server",
            newest: undefined,
            oldest: "2026-08-11T12:00:00Z",
            order: "ascending",
        })
    })

    it("stops when explicit response windowing has no next cursor", () => {
        expect(
            nextSessionCursor({
                count: 1,
                sessions: [row],
                windowing: {limit: 1, order: "descending"},
            }),
        ).toBeUndefined()
    })

    it("reconstructs descending and ascending cursors only for old responses", () => {
        const oldPage = {count: 1, sessions: [row]}
        expect(nextSessionCursor(oldPage, 1)).toEqual({
            next: "row-fallback",
            newest: "2026-08-10T12:00:00Z",
            order: "descending",
        })
        expect(nextSessionCursor(oldPage, 1, "ascending")).toEqual({
            next: "row-fallback",
            oldest: "2026-08-10T12:00:00Z",
            order: "ascending",
        })
    })
})
