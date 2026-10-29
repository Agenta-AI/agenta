// @vitest-environment jsdom
/**
 * Opening a chat adds no request (M3 gate, latency finding 4). The session fetch the screen
 * already makes (`useSessionHeader`) carries the caller's sharing state (visibility, my role,
 * can_send, not_shareable_reason, owner active), so the open path makes no
 * `GET /sessions/{id}/sharing`, and the members query runs only when a name is needed (the
 * Share dialog, or the owner's chip for a reader who is not the owner).
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
const fresh = vi.hoisted(() => new Set<string>())

vi.mock("@agenta/sdk/resources", () => ({
    getSharingClient: () => sharing,
    getSessionsClient: vi.fn(),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))
// The fresh-session marker only; the rest of the session entity is not read here.
vi.mock("@agenta/entities/session", () => ({
    isSessionFresh: (sessionId: string) => fresh.has(sessionId),
}))
// The session fetch the screen already makes carries the caller's sharing state.
const header = vi.hoisted(() => ({data: null as unknown}))
vi.mock("@/features/chat/useSessionHeader", () => ({
    useSessionHeader: () => ({isSuccess: true, data: header.data}),
}))

import {useChatAccess} from "@/features/chat/useChatAccess"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT = "proj-1"

let host: HTMLDivElement
let root: Root
let seen: ReturnType<typeof useChatAccess>

const Probe = ({sessionId}: {sessionId: string}) => {
    seen = useChatAccess({sessionId, projectId: PROJECT, agentHidden: false})
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
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)))
}

beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: false})
    sharing.fetchSessionSharing.mockReset()
    sharing.querySharingMembers.mockReset()
    sharing.querySharingMembers.mockResolvedValue({count: 0, members: []})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
})

const row = (sharingState: Record<string, unknown>) => ({session_id: "s", sharing: sharingState})

describe("opening an existing chat", () => {
    it("the owner's chat: no sharing read and no members query on open", async () => {
        header.data = row({
            policy: {visibility: "private", owner_user_id: "alice"},
            owner_is_active: true,
            grants: [],
            my_role: "owner",
            can_send: true,
            shareable: true,
            not_shareable_reason: null,
        })
        await mount("open-owner")

        expect(seen.canSend).toBe(true)
        expect(sharing.fetchSessionSharing).not.toHaveBeenCalled()
        expect(sharing.querySharingMembers).not.toHaveBeenCalled()
    })

    it("a viewer's chat: read-only from the session fetch, no sharing read", async () => {
        header.data = row({
            policy: {visibility: "private", owner_user_id: "alice"},
            owner_is_active: true,
            grants: [],
            my_role: "viewer",
            can_send: false,
            shareable: true,
            not_shareable_reason: null,
        })
        await mount("open-viewer")

        expect(seen.canSend).toBe(false)
        expect(seen.readOnly?.reason).toBe("viewer")
        expect(sharing.fetchSessionSharing).not.toHaveBeenCalled()
    })
})
