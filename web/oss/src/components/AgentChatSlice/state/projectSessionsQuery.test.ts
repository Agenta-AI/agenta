import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {querySessionsPage} = vi.hoisted(() => ({querySessionsPage: vi.fn()}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/entities/session")>()
    return {...original, querySessionsPage}
})

import {
    projectSessionSummary,
    projectSessionsRequest,
    queryProjectSessions,
} from "./projectSessionsQuery"
import {reconcileServerSessionsAtomFamily, sessionHistoryAtomFamily} from "./sessions"

const rows = Array.from({length: 100}, (_, index) => ({
    project_id: "project-1",
    session_id: `session-${index}`,
    created_at: `2026-08-10T12:${String(index % 60).padStart(2, "0")}:00Z`,
}))

beforeEach(() => {
    querySessionsPage.mockReset()
})

describe("queryProjectSessions", () => {
    it("uses an unwindowed canonical request for reconciliation", () => {
        expect(projectSessionsRequest({projectId: "project-1", appId: "agent-1"})).toEqual({
            projectId: "project-1",
            session: undefined,
            exclude: undefined,
            turnReferences: [{id: "agent-1"}],
            includeEnded: true,
            includeArchived: true,
            includeTotal: false,
            expand: [],
            abortSignal: undefined,
            lowPriority: true,
        })
    })

    it("does not prune server-known local sessions beyond row 30", async () => {
        querySessionsPage.mockImplementation(async (request) => ({
            count: request.windowing?.limit ?? rows.length,
            sessions: request.windowing ? rows.slice(0, request.windowing.limit) : rows,
        }))
        const scope = `reconcile-full-${Date.now()}`
        const store = createStore()
        store.set(projectIdAtom, "proj-test")
        store.set(reconcileServerSessionsAtomFamily(scope), rows.map(projectSessionSummary))

        const fetched = await queryProjectSessions({projectId: "project-1", appId: "agent-1"})
        expect(fetched).toHaveLength(100)
        store.set(
            reconcileServerSessionsAtomFamily(scope),
            (fetched ?? []).map(projectSessionSummary),
        )

        const ids = store.get(sessionHistoryAtomFamily(scope)).map((session) => session.id)
        expect(ids).toHaveLength(100)
        expect(ids).toContain("session-99")
    })
})
