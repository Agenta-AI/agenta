// @vitest-environment jsdom
/**
 * A chat the user is creating is theirs (M3 gate, QA/latency finding 2). The agent page's
 * composer mints a session id, stashes the first message and opens the chat route. That
 * session has no row yet, so its sharing read answers 404; before the fix the id was never
 * marked fresh, `canSend` waited for a sharing state that could not exist, and the stashed
 * message never reached invoke (3 of 3 live runs).
 *
 * The rule: stashing a pending task for a session marks it as minted in this browser, so the
 * chat sends without waiting for a sharing read.
 */
import {act} from "react"

import {isSessionFresh} from "@agenta/entities/session"
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

vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getSharingClient: () => sharing,
}))
// The new session has no stream row yet.
vi.mock("@/features/chat/useSessionHeader", () => ({
    useSessionHeader: () => ({isSuccess: true, data: null}),
}))

import {useChatAccess} from "@/features/chat/useChatAccess"
import {stashPendingTaskAtom} from "@/features/home/pendingTask"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT = "proj-1"
const notFound = Object.assign(new Error("Not found"), {statusCode: 404})

let host: HTMLDivElement
let root: Root
let seen: ReturnType<typeof useChatAccess>

const Probe = ({sessionId}: {sessionId: string}) => {
    seen = useChatAccess({
        sessionId,
        projectId: PROJECT,
        routeAgentId: "agent-1",
        agentHidden: false,
    })
    return null
}

beforeEach(() => {
    sharing.fetchSessionSharing.mockReset()
    sharing.fetchSessionSharing.mockRejectedValue(notFound)
    sharing.querySharingMembers.mockResolvedValue({count: 0, members: []})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("a new chat started from an agent's page", () => {
    it("stashing its first message marks the session as minted here", () => {
        const store = createStore()
        store.set(stashPendingTaskAtom, {
            sessionId: "new-from-agent-1",
            task: {agentId: "agent-1", text: "hello"},
        })
        expect(isSessionFresh("new-from-agent-1")).toBe(true)
    })

    it("may send while its sharing read answers 404", async () => {
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        const store = createStore()
        store.set(queryClientAtom, client)
        store.set(projectIdAtom, PROJECT)
        store.set(stashPendingTaskAtom, {
            sessionId: "new-from-agent-2",
            task: {agentId: "agent-1", text: "hello"},
        })

        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <Provider store={store}>
                        <Probe sessionId="new-from-agent-2" />
                    </Provider>
                </QueryClientProvider>,
            ),
        )
        await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))))

        expect(seen.canSend).toBe(true)
        expect(seen.blocked).toBeNull()
        expect(seen.readOnly).toBeNull()
    })
})
