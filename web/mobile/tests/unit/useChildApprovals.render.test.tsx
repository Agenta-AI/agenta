// @vitest-environment jsdom
/**
 * Where the calling chat learns that a child waits: the project's actionable interactions, then
 * the session rows of the waiting sessions, read in batches of the server's page limit. The API
 * is mocked at the entities package's fetch module.
 */
import {act} from "react"

import {actionableInteractionsQueryKey} from "@agenta/sessions/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({
    queryInteractions: vi.fn(),
    querySessionsPage: vi.fn(),
}))

// The list options call the page fetcher inside the package, so it is mocked at its module.
vi.mock("../../../packages/agenta-entities/src/session/api/api", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("../../../packages/agenta-entities/src/session/api/api")
    >()),
    queryInteractions: (...args: unknown[]) => api.queryInteractions(...args),
    querySessionsPage: (...args: unknown[]) => api.querySessionsPage(...args),
}))

import type {ChildApprovals} from "../../src/features/chat/childApprovals"
import {useChildApprovals} from "../../src/features/chat/useChildApprovals"

const OPEN = "open-session"

let host: HTMLDivElement
let root: Root
let client: QueryClient
let result: ChildApprovals[] = []

const Probe = () => {
    result = useChildApprovals({sessionId: OPEN, projectId: "proj-1"})
    return null
}

const flush = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))))

const mount = async (retry: number | false = false) => {
    client = new QueryClient({defaultOptions: {queries: {retry, retryDelay: 0}}})
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <Probe />
            </QueryClientProvider>,
        ),
    )
    await flush()
    await flush()
}

const gate = (sessionId: string, token: string) => ({
    id: `i-${token}`,
    session_id: sessionId,
    token,
    kind: "user_approval",
    status: "pending",
    data: {request: {tool: "send_email", args: {}}},
})

beforeEach(() => {
    api.queryInteractions.mockReset()
    api.querySessionsPage.mockReset()
    result = []
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("useChildApprovals", () => {
    it("reads the rows of every waiting session in batches and keeps this session's children", async () => {
        // 250 other sessions wait; the child of the open session sorts last.
        const others = Array.from({length: 249}, (_, i) => `a-${String(i).padStart(3, "0")}`)
        api.queryInteractions.mockResolvedValue([
            ...others.map((id) => gate(id, `t-${id}`)),
            gate("z-child", "t-child"),
            gate(OPEN, "t-own"),
        ])
        api.querySessionsPage.mockImplementation(async ({sessionIds}: {sessionIds: string[]}) => ({
            count: sessionIds.length,
            sessions: sessionIds.map((id) => ({
                session_id: id,
                calling_session: id === "z-child" ? {id: OPEN} : null,
            })),
        }))
        await mount()

        const batches = api.querySessionsPage.mock.calls.map(
            ([args]) => (args as {sessionIds: string[]}).sessionIds,
        )
        expect(batches.map((ids) => ids.length)).toEqual([200, 50])
        expect(batches.flat()).not.toContain(OPEN)
        expect(
            api.querySessionsPage.mock.calls.map(
                ([args]) => (args as {windowing: {limit: number}}).windowing.limit,
            ),
        ).toEqual([200, 50])
        expect(result).toEqual([
            {
                sessionId: "z-child",
                approvals: [{approvalId: "t-child", toolName: "send_email", input: {}}],
            },
        ])
    })

    it("retries a failed read of the waiting sessions instead of reading it as no children", async () => {
        const child = {session_id: "z-child", calling_session: {id: OPEN}}
        api.queryInteractions.mockResolvedValue([gate("z-child", "t-child")])
        api.querySessionsPage.mockResolvedValue({count: 1, sessions: [child]})
        await mount(1)
        expect(result.map((entry) => entry.sessionId)).toEqual(["z-child"])

        // A second session starts waiting; the first read of the new id set fails (the fetcher
        // answers null), the retry succeeds.
        api.queryInteractions.mockResolvedValue([
            gate("z-child", "t-child"),
            gate("other", "t-other"),
        ])
        api.querySessionsPage.mockResolvedValueOnce(null).mockResolvedValue({
            count: 2,
            sessions: [child, {session_id: "other", calling_session: null}],
        })
        await act(async () => {
            await client.invalidateQueries({queryKey: actionableInteractionsQueryKey("proj-1")})
        })
        await flush()
        await flush()

        expect(api.querySessionsPage).toHaveBeenCalledTimes(3)
        expect(result.map((entry) => entry.sessionId)).toEqual(["z-child"])
    })

    it("reads the rows again when the session lists are invalidated (a child is archived)", async () => {
        api.queryInteractions.mockResolvedValue([gate("z-child", "t-child")])
        api.querySessionsPage.mockResolvedValue({
            count: 1,
            sessions: [{session_id: "z-child", calling_session: {id: OPEN}}],
        })
        await mount()
        expect(result.map((entry) => entry.sessionId)).toEqual(["z-child"])

        // Archived: the list leaves it out, while its interaction still waits.
        api.querySessionsPage.mockResolvedValue({count: 0, sessions: []})
        await act(async () => {
            await client.invalidateQueries({
                predicate: (query) => query.queryKey.includes("session-list"),
            })
        })
        await flush()

        expect(result).toEqual([])
    })

    it("reads no session rows when no other session waits", async () => {
        api.queryInteractions.mockResolvedValue([gate(OPEN, "t-own")])
        await mount()

        expect(api.querySessionsPage).not.toHaveBeenCalled()
        expect(result).toEqual([])
    })
})
