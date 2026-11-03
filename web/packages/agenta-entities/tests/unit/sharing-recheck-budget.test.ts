// @vitest-environment jsdom
/**
 * The open session's sharing recheck: one read per open session per 60 s at most, whatever
 * asks for it (the poll, a window focus, a remount, the watch stream closing), and none once
 * the session closes. Counted as requests to the Fern client, not as query options.
 */
import {focusManager, QueryClient} from "@tanstack/react-query"
import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const sharing = vi.hoisted(() => ({fetchSessionSharing: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getSharingClient: () => sharing,
    getSessionsClient: vi.fn(),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {
    recheckSessionSharing,
    SESSION_SHARING_RECHECK_MS,
    sessionSharingQueryAtomFamily,
} from "../../src/sharing"

const PROJECT = "0190a3c4-0000-7000-8000-0000000000p1"
const ALICE = "0190a3c4-0000-7000-8000-00000000a11c"

const response = {
    count: 1,
    sharing: {
        policy: {visibility: "private", owner_user_id: ALICE},
        owner_is_active: true,
        grants: [],
        my_role: "owner",
        can_send: true,
        shareable: true,
    },
    disclosure: null,
}
const serverError = Object.assign(new Error("Boom"), {statusCode: 500})
const notFound = Object.assign(new Error("Not found"), {statusCode: 404})

let client: QueryClient
let store: ReturnType<typeof createStore>
let session = 0

/** A fresh session id per case: the atom family keeps one query atom per id. */
const nextSession = () => `0190a3c4-0000-7000-8000-${String(++session).padStart(12, "0")}`

const open = (sessionId: string) => store.sub(sessionSharingQueryAtomFamily(sessionId), () => {})
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)
const requests = () => sharing.fetchSessionSharing.mock.calls.length
const recheck = (sessionId: string) =>
    recheckSessionSharing({queryClient: client, sessionId, projectId: PROJECT})

beforeEach(() => {
    vi.useFakeTimers({shouldAdvanceTime: false})
    sharing.fetchSessionSharing.mockReset()
    sharing.fetchSessionSharing.mockResolvedValue(response)
    client = new QueryClient()
    // What the app's QueryClientProvider does: focus and reconnect reach the queries.
    client.mount()
    store = createStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, PROJECT)
    focusManager.setFocused(true)
})

afterEach(() => {
    client.clear()
    client.unmount()
    focusManager.setFocused(undefined)
    vi.useRealTimers()
})

describe("one sharing read per open session per 60 s", () => {
    it("the poll reads once per minute", async () => {
        const close = open(nextSession())
        await advance(0)
        expect(requests()).toBe(1)

        await advance(SESSION_SHARING_RECHECK_MS - 1_000)
        expect(requests()).toBe(1)
        await advance(1_500)
        expect(requests()).toBe(2)
        close()
    })

    it("a window focus inside the budget reads nothing", async () => {
        const close = open(nextSession())
        await advance(0)

        // Past the old 30 s stale time, inside the 60 s budget.
        await advance(45_000)
        focusManager.setFocused(false)
        focusManager.setFocused(true)
        await advance(0)
        expect(requests()).toBe(1)
        close()
    })

    it("a focus after the budget reads once, and the poll restarts from it", async () => {
        const close = open(nextSession())
        await advance(0)
        // Hidden: the poll skips its beats.
        focusManager.setFocused(false)
        await advance(150_000)
        expect(requests()).toBe(1)

        focusManager.setFocused(true)
        await advance(0)
        expect(requests()).toBe(2)
        await advance(SESSION_SHARING_RECHECK_MS - 1_000)
        expect(requests()).toBe(2)
        await advance(1_500)
        expect(requests()).toBe(3)
        close()
    })

    it("a remount inside the budget reads nothing", async () => {
        const sessionId = nextSession()
        const first = open(sessionId)
        await advance(0)
        first()
        await advance(10_000)
        const second = open(sessionId)
        await advance(0)
        expect(requests()).toBe(1)
        second()
    })

    it("a remount after a failed read reads it once more, with one retry at most", async () => {
        // The atom resets a failed query when its last reader leaves, so the next reader asks
        // again: a navigation back to the chat, not a storm.
        sharing.fetchSessionSharing.mockRejectedValue(serverError)
        const sessionId = nextSession()
        const first = open(sessionId)
        await advance(5_000)
        expect(requests()).toBe(2)
        first()
        const second = open(sessionId)
        await advance(5_000)
        expect(requests()).toBe(4)
        await advance(SESSION_SHARING_RECHECK_MS - 10_000)
        expect(requests()).toBe(4)
        second()
    })

    it("a focus after a failed first read waits for the budget too", async () => {
        sharing.fetchSessionSharing.mockRejectedValue(notFound)
        const close = open(nextSession())
        await advance(0)
        expect(requests()).toBe(1)

        for (let i = 0; i < 3; i += 1) {
            focusManager.setFocused(false)
            focusManager.setFocused(true)
            await advance(10_000)
        }
        expect(requests()).toBe(1)

        await advance(SESSION_SHARING_RECHECK_MS)
        expect(requests()).toBe(2)
        close()
    })

    it("a network reconnect inside the budget reads nothing", async () => {
        const {onlineManager} = await import("@tanstack/react-query")
        const close = open(nextSession())
        await advance(0)
        onlineManager.setOnline(false)
        onlineManager.setOnline(true)
        await advance(0)
        expect(requests()).toBe(1)
        close()
    })

    it("a 404 is not retried", async () => {
        sharing.fetchSessionSharing.mockRejectedValue(notFound)
        const close = open(nextSession())
        await advance(10_000)
        expect(requests()).toBe(1)
        close()
    })

    it("closing the session stops the reads", async () => {
        const close = open(nextSession())
        await advance(0)
        close()
        await advance(5 * SESSION_SHARING_RECHECK_MS)
        expect(requests()).toBe(1)
    })
})

describe("a forced recheck (the watch stream closed)", () => {
    it("inside the budget reads nothing, however often it is asked", async () => {
        const sessionId = nextSession()
        const close = open(sessionId)
        await advance(0)

        for (let i = 0; i < 5; i += 1) {
            await recheck(sessionId)
            await advance(5_000)
        }
        expect(requests()).toBe(1)
        close()
    })

    it("after the budget reads once", async () => {
        const sessionId = nextSession()
        const close = open(sessionId)
        await advance(0)
        focusManager.setFocused(false)
        await advance(SESSION_SHARING_RECHECK_MS + 5_000)

        await recheck(sessionId)
        await recheck(sessionId)
        expect(requests()).toBe(2)
        close()
    })

    it("a focus read and a recheck right after it make one read", async () => {
        const sessionId = nextSession()
        const close = open(sessionId)
        await advance(0)
        focusManager.setFocused(false)
        await advance(SESSION_SHARING_RECHECK_MS + 5_000)
        focusManager.setFocused(true)
        // The focus read already ran; the stream closing right after it adds nothing.
        await advance(0)
        expect(requests()).toBe(2)
        await recheck(sessionId)
        await advance(30_000)
        expect(requests()).toBe(2)
        close()
    })

    it("a failed read counts against the budget too", async () => {
        sharing.fetchSessionSharing.mockRejectedValue(notFound)
        const sessionId = nextSession()
        const close = open(sessionId)
        await advance(0)
        await recheck(sessionId)
        await advance(20_000)
        await recheck(sessionId)
        expect(requests()).toBe(1)
        close()
    })

    it("a closed session is never re-read", async () => {
        const sessionId = nextSession()
        const close = open(sessionId)
        await advance(0)
        close()
        await advance(2 * SESSION_SHARING_RECHECK_MS)
        await recheck(sessionId)
        expect(requests()).toBe(1)
    })
})
