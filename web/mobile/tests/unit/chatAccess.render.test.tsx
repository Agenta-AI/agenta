// @vitest-environment jsdom
/**
 * What the chat may do while its sharing state loads, fails, and changes under it. The state
 * rides on the session row the screen already reads (`useSessionHeader`, a stubbed
 * `querySessionStreams` underneath), so the 60 s recheck is that query's own and a revocation
 * reaches the screen through it. No sharing request is made.
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
const rows = vi.hoisted(() => ({querySessionStreams: vi.fn()}))
// The fresh-session marker and the session row read; the rest of the entity is not read here.
vi.mock("@agenta/entities/session", () => ({
    isSessionFresh: (sessionId: string) => fresh.has(sessionId),
    querySessionStreams: (...args: unknown[]) => rows.querySessionStreams(...args),
}))

import {useChatAccess} from "@/features/chat/useChatAccess"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT = "proj-1"

// The session row with the reader's sharing state.
const state = (role: "owner" | "participant" | "viewer") => [
    {
        project_id: "proj-1",
        session_id: "s",
        sharing: {
            policy: {visibility: "private", owner_user_id: "alice"},
            owner_is_active: true,
            grants: [],
            my_role: role,
            can_send: role !== "viewer",
            shareable: true,
        },
    },
]
// The row is not readable (hidden, unknown, or access removed): no row.
const notFound: unknown[] = []
// A failed read (`querySessionStreams` answers null).
const serverError = null

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
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: false})
    rows.querySessionStreams.mockReset()
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

describe("until the sharing state of an existing chat is known", () => {
    it("loading: nothing may write, and no notice flashes", async () => {
        rows.querySessionStreams.mockReturnValue(new Promise(() => undefined))
        await mount("existing-loading")

        expect(seen.canSend).toBe(false)
        expect(seen.readOnly).toBeNull()
        expect(seen.blocked).toBeNull()
    })

    it("failed: nothing may write, and the composer's place says the read failed", async () => {
        rows.querySessionStreams.mockResolvedValue(serverError)
        await mount("existing-failed")
        // A failed read is retried once before it counts as failed.
        await advance(0)
        expect(seen.canSend).toBe(false)
        expect(seen.readOnly).toBeNull()
        await advance(1_500)

        expect(seen.canSend).toBe(false)
        expect(seen.readOnly?.reason).toBe("access_unknown")
        expect(seen.readOnly?.notice).toBe("Couldn't load who has access to this chat.")
        expect(seen.readOnly?.approvalNote).toBeNull()
    })

    it("a chat minted in this browser keeps sending before it has a sharing row", async () => {
        fresh.add("fresh-draft")
        rows.querySessionStreams.mockResolvedValue(notFound)
        await mount("fresh-draft")
        await advance(0)

        expect(seen.canSend).toBe(true)
        expect(seen.readOnly).toBeNull()
        expect(seen.blocked).toBeNull()
    })

    it("a known state that allows sending enables it", async () => {
        rows.querySessionStreams.mockResolvedValue(state("participant"))
        await mount("existing-known")
        await advance(0)

        expect(seen.canSend).toBe(true)
        expect(seen.readOnly).toBeNull()
    })
})

describe("a sharing change while the chat stays open", () => {
    it("a revoked grant replaces the chat within the 60 s recheck", async () => {
        rows.querySessionStreams.mockResolvedValueOnce(state("participant"))
        await mount("revoked")
        await advance(0)
        expect(seen.canSend).toBe(true)

        rows.querySessionStreams.mockResolvedValue(notFound)
        await advance(59_000)
        expect(seen.blocked).toBeNull()
        await advance(1_500)

        expect(seen.blocked).toBe("removed")
        expect(seen.canSend).toBe(false)
    })

    it("a background re-read keeps the last answer until it answers", async () => {
        // Conductor decision (Codex r8 #2, partly rejected): the composer does not flicker off
        // once a minute. A re-read that answers without send access, or fails, takes it away.
        rows.querySessionStreams.mockResolvedValueOnce(state("participant"))
        await mount("refetching")
        await advance(0)
        expect(seen.canSend).toBe(true)

        let answer: (value: unknown) => void = () => undefined
        rows.querySessionStreams.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
        await advance(60_500)
        expect(rows.querySessionStreams).toHaveBeenCalledTimes(2)
        expect(sharing.fetchSessionSharing).not.toHaveBeenCalled()
        expect(seen.canSend).toBe(true)

        await act(async () => answer(state("viewer")))
        await advance(0)
        expect(seen.canSend).toBe(false)
        expect(seen.readOnly?.reason).toBe("viewer")
    })

    it("a background re-read that fails takes the controls away", async () => {
        rows.querySessionStreams.mockResolvedValueOnce(state("participant"))
        await mount("refetch-fails")
        await advance(0)
        expect(seen.canSend).toBe(true)

        rows.querySessionStreams.mockResolvedValue(serverError)
        await advance(60_500)
        await advance(1_500)
        expect(seen.canSend).toBe(false)
        expect(seen.readOnly?.reason).toBe("access_unknown")
    })

    it("a lowered role takes the controls away", async () => {
        rows.querySessionStreams.mockResolvedValueOnce(state("participant"))
        await mount("lowered")
        await advance(0)
        expect(seen.canSend).toBe(true)

        rows.querySessionStreams.mockResolvedValue(state("viewer"))
        await advance(60_500)

        expect(seen.readOnly?.reason).toBe("viewer")
        expect(seen.canSend).toBe(false)
    })
})
