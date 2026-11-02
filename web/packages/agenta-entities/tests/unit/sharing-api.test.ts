import {QueryClient} from "@tanstack/react-query"
import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const sharing = {
    fetchAgentSharing: vi.fn(),
    setAgentVisibility: vi.fn(),
    transferAgent: vi.fn(),
    takeAgentOwnership: vi.fn(),
    fetchSessionSharing: vi.fn(),
    upsertSessionGrant: vi.fn(),
    revokeSessionGrant: vi.fn(),
    setSessionVisibility: vi.fn(),
    restrictSessionToOwner: vi.fn(),
    querySharingMembers: vi.fn(),
}
const setSessionStreamHeader = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getSharingClient: () => sharing,
    getSessionsClient: () => ({setSessionStreamHeader}),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

const queryClient = new QueryClient()
vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getHostQueryClient: () => queryClient,
}))

import {setSessionHeader} from "../../src/session/api/api"
import {
    accessPolicySchema,
    agentSharingResponseSchema,
    fetchAgentSharing,
    fetchSharingMemberRoster,
    MEMBER_ROSTER_PAGE_SIZE,
    querySharingMembers,
    SESSION_SHARING_RECHECK_MS,
    sessionSharingQueryAtomFamily,
    revokeSessionGrant,
    sessionSharingResponseSchema,
    sessionSharingStateSchema,
    setAgentVisibilityAtom,
    sharingKeys,
    sharingMembersResponseSchema,
    transferAgent,
    upsertSessionGrant,
    upsertSessionGrantAtom,
} from "../../src/sharing"

const ALICE = "0190a3c4-0000-7000-8000-00000000a11c"
const BOB = "0190a3c4-0000-7000-8000-000000000b0b"
const STREAM = "0190a3c4-0000-7000-8000-0000000057e1"

describe("sharing schemas", () => {
    it("parses an agent sharing response and keeps unknown fields out", () => {
        const wire = {
            count: 1,
            sharing: {
                policy: {visibility: "private", owner_user_id: ALICE, extra_policy: 1},
                owner_is_active: true,
                my_role: "owner",
                can_take_ownership: false,
                unknown_state_field: "x",
            },
            disclosure: {
                connections: [
                    {
                        provider: "composio",
                        integration: "github",
                        connection: "my-github",
                        secret: "do-not-keep",
                    },
                ],
                turns_use_run_credentials: true,
                files_and_tool_results_shared: true,
                trace_readers_can_read: true,
            },
            unknown_top_level: true,
        }

        const parsed = agentSharingResponseSchema.parse(wire)

        expect(parsed).toEqual({
            count: 1,
            sharing: {
                policy: {visibility: "private", owner_user_id: ALICE},
                owner_is_active: true,
                my_role: "owner",
                can_take_ownership: false,
            },
            disclosure: {
                connections: [
                    {provider: "composio", integration: "github", connection: "my-github"},
                ],
                turns_use_run_credentials: true,
                files_and_tool_results_shared: true,
                trace_readers_can_read: true,
            },
        })
    })

    it('parses an agent with a personal Gmail tool: a "user" item names no connection', () => {
        // GET /workflows/{id}/sharing on A2: the router drops None fields, so no `connection` key.
        const parsed = agentSharingResponseSchema.parse({
            count: 1,
            sharing: {
                policy: {visibility: "private", owner_user_id: ALICE},
                owner_is_active: true,
                my_role: "owner",
                can_take_ownership: false,
            },
            disclosure: {
                connections: [{provider: "composio", integration: "gmail", account_source: "user"}],
                turns_use_run_credentials: true,
                files_and_tool_results_shared: true,
                trace_readers_can_read: true,
            },
        })

        expect(parsed.disclosure.connections).toEqual([
            {provider: "composio", integration: "gmail", account_source: "user"},
        ])
    })

    it("parses a session sharing response with grants and a null disclosure", () => {
        const parsed = sessionSharingResponseSchema.parse({
            count: 1,
            sharing: {
                policy: {visibility: "private", owner_user_id: ALICE},
                owner_is_active: true,
                grants: [
                    {
                        stream_id: STREAM,
                        user_id: BOB,
                        role: "participant",
                        created_at: "2026-10-22T10:00:00Z",
                        created_by_id: ALICE,
                    },
                ],
                my_role: "owner",
                can_send: true,
                shareable: true,
            },
            disclosure: null,
        })

        expect(parsed.disclosure).toBeNull()
        expect(parsed.sharing.grants[0]?.role).toBe("participant")
    })

    it("parses the reason a session cannot be shared, absent when shareable", () => {
        const sharing = {
            policy: {visibility: "project"},
            owner_is_active: false,
            grants: [],
            my_role: "viewer",
            can_send: false,
            shareable: false,
        }
        for (const reason of ["channel", "ownerless", "no_agent"] as const) {
            const parsed = sessionSharingStateSchema.parse({
                ...sharing,
                not_shareable_reason: reason,
            })
            expect(parsed.not_shareable_reason).toBe(reason)
        }
        expect(sessionSharingStateSchema.parse(sharing).not_shareable_reason).toBeUndefined()
        expect(
            sessionSharingStateSchema.safeParse({...sharing, not_shareable_reason: "other"})
                .success,
        ).toBe(false)
    })

    it("parses a members response with an optional windowing", () => {
        const parsed = sharingMembersResponseSchema.parse({
            count: 1,
            members: [{user_id: BOB, email: "bob@example.com", name: null, role: "editor"}],
        })

        expect(parsed.members[0]?.name).toBeNull()
        expect(parsed.windowing).toBeUndefined()
    })

    it("rejects a private policy without an owner", () => {
        expect(accessPolicySchema.safeParse({visibility: "private"}).success).toBe(false)
        expect(
            accessPolicySchema.safeParse({visibility: "private", owner_user_id: null}).success,
        ).toBe(false)
        expect(accessPolicySchema.safeParse({visibility: "project"}).success).toBe(true)
        expect(
            accessPolicySchema.safeParse({visibility: "private", owner_user_id: ALICE}).success,
        ).toBe(true)
    })
})

describe("sharingKeys", () => {
    it("query keys include the project id", () => {
        expect(sharingKeys.agent("wf-1", "proj-1")).toEqual(["sharing", "agent", "wf-1", "proj-1"])
        expect(sharingKeys.session("s-1", "proj-1")).toEqual([
            "sharing",
            "session",
            "s-1",
            "proj-1",
        ])
        expect(sharingKeys.members("proj-1", "bo")).toEqual(["sharing", "members", "proj-1", "bo"])

        expect(sharingKeys.agent("wf-1", "proj-1").at(-1)).toBe("proj-1")
        expect(sharingKeys.session("s-1", "proj-1").at(-1)).toBe("proj-1")
        expect(sharingKeys.members("proj-1", "bo")[2]).toBe("proj-1")
    })
})

const PROJECT = "0190a3c4-0000-7000-8000-0000000000p1"
const WORKFLOW = "0190a3c4-0000-7000-8000-0000000000f1"
const SESSION = "session-1"

const agentResponse = {
    count: 1,
    sharing: {
        policy: {visibility: "private", owner_user_id: ALICE},
        owner_is_active: true,
        my_role: "owner",
        can_take_ownership: false,
    },
    disclosure: {
        connections: [],
        turns_use_run_credentials: true,
        files_and_tool_results_shared: true,
        trace_readers_can_read: true,
    },
}

// The router drops None fields (`response_model_exclude_none`), so a session that cannot be
// shared comes back WITHOUT a disclosure key, and a member without a name has no `name`.
const sessionResponse = {
    count: 1,
    sharing: {
        policy: {visibility: "private", owner_user_id: ALICE},
        owner_is_active: true,
        grants: [{stream_id: STREAM, user_id: BOB, role: "viewer"}],
        my_role: "owner",
        can_send: true,
        shareable: true,
    },
}

const scoped = {queryParams: {project_id: PROJECT}, abortSignal: undefined}

describe("sharing api requests", () => {
    beforeEach(() => {
        for (const fn of Object.values(sharing)) fn.mockReset()
        setSessionStreamHeader.mockReset()
        queryClient.clear()
    })

    it("calls getSharingClient with snake_case bodies", async () => {
        sharing.upsertSessionGrant.mockResolvedValue(sessionResponse)
        sharing.transferAgent.mockResolvedValue(agentResponse)
        sharing.revokeSessionGrant.mockResolvedValue(sessionResponse)

        const grant = await upsertSessionGrant({
            projectId: PROJECT,
            sessionId: SESSION,
            userId: BOB,
            role: "viewer",
        })
        await transferAgent({projectId: PROJECT, workflowId: WORKFLOW, userId: BOB})
        await revokeSessionGrant({projectId: PROJECT, sessionId: SESSION, userId: BOB})

        expect(sharing.upsertSessionGrant).toHaveBeenCalledWith(
            {session_id: SESSION, user_id: BOB, role: "viewer"},
            scoped,
        )
        expect(sharing.transferAgent).toHaveBeenCalledWith(
            {workflow_id: WORKFLOW, user_id: BOB},
            scoped,
        )
        expect(sharing.revokeSessionGrant).toHaveBeenCalledWith(
            {session_id: SESSION, user_id: BOB},
            scoped,
        )
        expect(grant.disclosure).toBeUndefined()
        expect(grant.sharing.grants[0]?.user_id).toBe(BOB)
    })

    it("validates responses and fails on a malformed one", async () => {
        sharing.fetchAgentSharing.mockResolvedValue({count: 1, sharing: {policy: {}}})

        await expect(fetchAgentSharing({projectId: PROJECT, workflowId: WORKFLOW})).rejects.toThrow(
            /fetchAgentSharing/,
        )
    })

    it("sends the member search and page in the body", async () => {
        sharing.querySharingMembers.mockResolvedValue({
            count: 1,
            members: [{user_id: BOB, email: "bob@example.com"}],
        })

        const page = await querySharingMembers({projectId: PROJECT, search: "bo", limit: 20})

        expect(sharing.querySharingMembers).toHaveBeenCalledWith(
            {body: {search: "bo", windowing: {limit: 20}}},
            scoped,
        )
        expect(page.members[0]?.email).toBe("bob@example.com")
    })

    it("sends visibility as a query parameter on the header call", async () => {
        setSessionStreamHeader.mockResolvedValue({count: 1})

        await setSessionHeader({
            projectId: PROJECT,
            sessionId: SESSION,
            name: "Draft",
            visibility: "private",
        })

        const [request, options] = setSessionStreamHeader.mock.calls[0] ?? []
        expect(request).toEqual({session_id: SESSION, body: {name: "Draft"}})
        expect(options.queryParams).toEqual({project_id: PROJECT, visibility: "private"})
    })

    it("a mutation sets the sharing key and invalidates the project's lists", async () => {
        sharing.setAgentVisibility.mockResolvedValue(agentResponse)
        sharing.upsertSessionGrant.mockResolvedValue(sessionResponse)
        const store = createStore()
        store.set(projectIdAtom, PROJECT)
        const invalidate = vi.spyOn(queryClient, "invalidateQueries")

        const sessionList = ["session-list", PROJECT, ""]
        const mobileSessionList = ["mobile", "head", "session-list", PROJECT]
        const otherProjectList = ["session-list", "other-project", ""]
        const workflowList = ["workflows", "apps", "list", PROJECT]
        for (const key of [sessionList, mobileSessionList, otherProjectList, workflowList]) {
            queryClient.setQueryData(key, {})
        }

        await store.set(setAgentVisibilityAtom, {workflowId: WORKFLOW, visibility: "private"})
        await store.set(upsertSessionGrantAtom, {sessionId: SESSION, userId: BOB, role: "viewer"})

        expect(sharing.setAgentVisibility).toHaveBeenCalledWith(
            {workflow_id: WORKFLOW, visibility: "private"},
            scoped,
        )
        expect(queryClient.getQueryData(sharingKeys.agent(WORKFLOW, PROJECT))).toEqual(
            agentResponse,
        )
        expect(queryClient.getQueryData(sharingKeys.session(SESSION, PROJECT))).toEqual(
            sessionResponse,
        )
        expect(invalidate).toHaveBeenCalled()
        const isInvalid = (key: unknown[]) => queryClient.getQueryState(key)?.isInvalidated
        expect(isInvalid(sessionList)).toBe(true)
        expect(isInvalid(mobileSessionList)).toBe(true)
        expect(isInvalid(workflowList)).toBe(true)
        expect(isInvalid(otherProjectList)).toBe(false)
    })

    it("reads the whole member roster page by page", async () => {
        sharing.querySharingMembers
            .mockResolvedValueOnce({
                count: 1,
                members: [{user_id: ALICE, email: "alice@example.com"}],
                windowing: {next: ALICE, limit: MEMBER_ROSTER_PAGE_SIZE},
            })
            .mockResolvedValueOnce({
                count: 1,
                members: [{user_id: BOB, email: "bob@example.com"}],
            })

        const roster = await fetchSharingMemberRoster({projectId: PROJECT})

        expect(roster.map((member) => member.user_id)).toEqual([ALICE, BOB])
        expect(sharing.querySharingMembers).toHaveBeenNthCalledWith(
            2,
            {body: {windowing: {limit: MEMBER_ROSTER_PAGE_SIZE, next: ALICE}}},
            scoped,
        )
    })

    it("fails rather than return a truncated roster", async () => {
        sharing.querySharingMembers.mockResolvedValue({
            count: 1,
            members: [{user_id: ALICE, email: "alice@example.com"}],
            windowing: {next: ALICE, limit: MEMBER_ROSTER_PAGE_SIZE},
        })

        await expect(fetchSharingMemberRoster({projectId: PROJECT})).rejects.toThrow(/pages/)
    })
})

describe("the open session's sharing state", () => {
    it("re-reads every 60 s and on focus, so a revoked grant reaches the screen", async () => {
        const {queryClientAtom} = await import("jotai-tanstack-query")
        const client = new QueryClient()
        const store = createStore()
        store.set(queryClientAtom, client)
        store.set(projectIdAtom, PROJECT)
        sharing.fetchSessionSharing.mockResolvedValue(sessionResponse)

        const unsubscribe = store.sub(sessionSharingQueryAtomFamily(SESSION), () => undefined)
        const [observer] =
            client.getQueryCache().find({queryKey: sharingKeys.session(SESSION, PROJECT)})
                ?.observers ?? []
        unsubscribe()

        expect(SESSION_SHARING_RECHECK_MS).toBe(60_000)
        expect(observer?.options.refetchInterval).toBe(SESSION_SHARING_RECHECK_MS)
        // A function: focus re-reads only once the 60 s budget ran out (sharing-recheck-budget).
        expect(typeof observer?.options.refetchOnWindowFocus).toBe("function")
    })
})
