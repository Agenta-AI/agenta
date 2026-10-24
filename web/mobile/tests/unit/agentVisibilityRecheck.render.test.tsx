// @vitest-environment jsdom
/**
 * An agent made private while its chat stays open goes hidden at the next sharing recheck. The
 * chain is the real one: the session sharing query polls (60 s), each read re-reads the agent's
 * latest revision, and the server answering that read like an unknown agent is `agentHidden`.
 * Only the Fern calls underneath are stubs.
 */
import {act} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const sharing = vi.hoisted(() => ({
    fetchSessionSharing: vi.fn(),
    querySharingMembers: vi.fn(),
}))
const retrieveWorkflowRevision = vi.hoisted(() => vi.fn())

vi.mock("@agenta/sdk/resources", () => ({
    getSharingClient: () => sharing,
    getSessionsClient: vi.fn(),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))
vi.mock("@agenta/entities/session", () => ({isSessionFresh: () => false}))
vi.mock("@agenta/entities/workflow", () => ({
    retrieveWorkflowRevision: (...args: unknown[]) => retrieveWorkflowRevision(...args),
}))
vi.mock("@/features/chat/useSessionHeader", () => ({
    useSessionHeader: () => ({
        isSuccess: true,
        isPending: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
        data: {session_id: "s", references: [{key: "workflow", id: AGENT}]},
    }),
}))

import {useAgentEntity} from "@/features/chat/useAgentEntity"
import {useAgentVisibilityRecheck} from "@/features/chat/useAgentVisibilityRecheck"
import {useChatAccess} from "@/features/chat/useChatAccess"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT = "proj-1"
const AGENT = "0190a3c4-0000-7000-8000-0000000a6e17"

const state = {
    count: 1,
    sharing: {
        policy: {visibility: "project", owner_user_id: "alice"},
        owner_is_active: true,
        grants: [],
        my_role: "participant",
        can_send: true,
        shareable: true,
    },
    disclosure: null,
}

let host: HTMLDivElement
let root: Root
let seen: {agentHidden: boolean; entityId: string | null; canSend: boolean}

/** What ChatScreen wires: the agent entity, the access gate, and the recheck between them. */
const Probe = ({sessionId}: {sessionId: string}) => {
    const agent = useAgentEntity(sessionId, PROJECT)
    const access = useChatAccess({sessionId, projectId: PROJECT, agentHidden: agent.agentHidden})
    useAgentVisibilityRecheck({
        checkedAt: access.checkedAt,
        enabled: Boolean(agent.agentId),
        refetch: agent.refetchLatest,
    })
    seen = {agentHidden: agent.agentHidden, entityId: agent.entityId, canSend: access.canSend}
    return null
}

const mount = async (sessionId: string) => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const store = createStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, PROJECT)
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <Provider store={store}>
                    <Probe sessionId={sessionId} />
                </Provider>
            </QueryClientProvider>,
        ),
    )
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: false})
    sharing.fetchSessionSharing.mockReset()
    sharing.fetchSessionSharing.mockResolvedValue(state)
    sharing.querySharingMembers.mockReset()
    sharing.querySharingMembers.mockResolvedValue({count: 0, members: []})
    retrieveWorkflowRevision.mockReset()
    retrieveWorkflowRevision.mockResolvedValue({id: "rev-1", workflow_id: AGENT})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
})

describe("an agent made private while its chat is open", () => {
    it("goes hidden at the next sharing recheck, and its revision is gone", async () => {
        await mount("made-private")
        await advance(0)
        expect(seen.agentHidden).toBe(false)
        expect(seen.entityId).toBe("rev-1")
        expect(retrieveWorkflowRevision).toHaveBeenCalledTimes(1)

        // The owner makes the agent private: every level answers like an unknown agent.
        retrieveWorkflowRevision.mockResolvedValue(null)
        await advance(59_000)
        expect(seen.agentHidden).toBe(false)
        expect(retrieveWorkflowRevision).toHaveBeenCalledTimes(1)

        await advance(1_500)
        // The revision re-read walks three levels before it answers; let its result render.
        await advance(0)
        expect(retrieveWorkflowRevision).toHaveBeenCalledTimes(4)
        expect(seen.agentHidden).toBe(true)
        expect(seen.entityId).toBeNull()
        expect(seen.canSend).toBe(false)
    })

    it("a visible agent costs one revision read per recheck, none in between", async () => {
        await mount("stays-visible")
        await advance(0)
        expect(retrieveWorkflowRevision).toHaveBeenCalledTimes(1)

        await advance(30_000)
        expect(retrieveWorkflowRevision).toHaveBeenCalledTimes(1)
        await advance(31_000)
        expect(retrieveWorkflowRevision).toHaveBeenCalledTimes(2)
        expect(sharing.fetchSessionSharing).toHaveBeenCalledTimes(2)
        expect(seen.agentHidden).toBe(false)
    })
})
