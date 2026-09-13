import {beforeEach, describe, expect, it, vi} from "vitest"

import {
    __resetSessionChatsForTest,
    commitSessionChat,
    createSessionChat,
    dropSessionChat,
    hasSessionChat,
    peekSessionChat,
    releaseSessionChat,
} from "../../../src/state/sessionChats"

// Neither dependency is under test: the transport reaches the playground request pipeline, and
// `Chat` owns the SSE read. What's under test is the claim/release policy over the instance map.
vi.mock("../../../src/transport/AgentChatTransport", () => ({AgentChatTransport: class {}}))
vi.mock("@ai-sdk/react", () => ({
    Chat: class {
        status = "ready"
        stop = vi.fn().mockResolvedValue(undefined)
        constructor(public init: Record<string, (arg: unknown) => void>) {}
    },
}))

interface FakeChat {
    status: string
    stop: ReturnType<typeof vi.fn>
    /** The callbacks the registry wired at construction, so a turn can be settled by hand. */
    init: {
        onFinish: (event: unknown) => void
        sendAutomaticallyWhen: (args: unknown) => boolean
    }
}

const hooks = () => ({
    prepareRequest: vi.fn(),
    sendAutomaticallyWhen: () => false,
    onFinish: vi.fn(),
    onError: vi.fn(),
    onData: vi.fn(),
})

/** Render creates the instance; the commit effect publishes it. `useSessionChat` does both. */
const render = (sessionId: string, initialMessages: unknown[] = [], mountHooks = hooks()) =>
    createSessionChat({
        sessionId,
        initialMessages: initialMessages as never,
        hooks: mountHooks as never,
    })

const mountAndCommit = (sessionId: string, initialMessages: unknown[] = [], h = hooks()) => {
    const handle = render(sessionId, initialMessages, h)
    commitSessionChat(sessionId, handle)
    return handle
}

let seq = 0
/** A committed chat under a session id no other test uses, with `status` forced. */
const mount = (status = "ready") => {
    const sessionId = `s${(seq += 1)}`
    const handle = mountAndCommit(sessionId)
    const chat = handle.chat as unknown as FakeChat
    chat.status = status
    return {sessionId, chat, handle}
}

beforeEach(() => {
    __resetSessionChatsForTest()
})

describe("session chat registry", () => {
    it("re-binds a remount to the same instance rather than reseeding it", () => {
        const {sessionId, chat} = mount()

        expect(peekSessionChat(sessionId)).toBe(chat as never)
    })

    it.each(["streaming", "submitted"])(
        "preserves a %s chat across a navigation, so the run is not killed",
        (status) => {
            const {sessionId, chat, handle} = mount(status)

            releaseSessionChat(sessionId, handle, {preserve: true})

            expect(chat.stop).not.toHaveBeenCalled()
            expect(hasSessionChat(sessionId)).toBe(true)
            // Returning gets the SAME live turn back.
            expect(peekSessionChat(sessionId)).toBe(chat as never)
        },
    )

    it("keeps a preserved idle chat, so a re-acquire never swaps the instance", () => {
        const {sessionId, chat, handle} = mount("ready")

        // StrictMode's dev mount runs the teardown effect once before re-running its setup; a
        // route change looks the same. Handing `useChat` a FRESH instance under the same id here
        // is the bug — it keys its message subscription on the id, so it would keep listening to
        // the dropped one.
        releaseSessionChat(sessionId, handle, {preserve: true})

        expect(chat.stop).not.toHaveBeenCalled()
        expect(peekSessionChat(sessionId)).toBe(chat as never)
    })

    it("disposes a streaming chat when the host says the session is gone", () => {
        const {sessionId, chat, handle} = mount("streaming")

        releaseSessionChat(sessionId, handle, {preserve: false})

        expect(chat.stop).toHaveBeenCalledTimes(1)
        expect(hasSessionChat(sessionId)).toBe(false)
    })

    it("still forwards a settled turn to the mount's own onFinish", () => {
        const {sessionId, chat} = mount("streaming")
        const mountHooks = hooks()
        commitSessionChat(sessionId, render(sessionId, [], mountHooks))

        chat.init.onFinish({message: {id: "m1"}})

        expect(mountHooks.onFinish).toHaveBeenCalledTimes(1)
    })

    it("drops a chat whose session is torn down while no mount holds it", () => {
        const {sessionId, chat, handle} = mount("streaming")
        releaseSessionChat(sessionId, handle, {preserve: true}) // navigated away, the run continues

        // Closed/deleted/archived from another route or another device: no pane is left to unmount,
        // so the session writers are the only teardown signal.
        dropSessionChat(sessionId)

        expect(chat.stop).toHaveBeenCalledTimes(1)
        expect(hasSessionChat(sessionId)).toBe(false)
    })

    it("ignores the abort-driven onFinish that its own stop() triggers a tick later", async () => {
        const {sessionId, chat} = mount("streaming")
        const mountHooks = hooks()
        commitSessionChat(sessionId, render(sessionId, [], mountHooks))
        // How `ai` settles an abort: the request unwinds, then `finally` runs `onFinish` with
        // `isAbort`. Without a disposal guard that revalidates a session that no longer exists.
        chat.stop.mockImplementation(async () => {
            await Promise.resolve()
            chat.init.onFinish({message: {id: "m1"}, isAbort: true})
        })

        dropSessionChat(sessionId)
        await chat.stop.mock.results[0]?.value

        expect(mountHooks.onFinish).not.toHaveBeenCalled()
    })

    it("does not let a disposed chat auto-resume after the abort", () => {
        const {sessionId, chat} = mount("streaming")
        // A gate answered just before the session was deleted leaves the predicate ready to fire.
        const mountHooks = {...hooks(), sendAutomaticallyWhen: vi.fn(() => true)}
        commitSessionChat(sessionId, render(sessionId, [], mountHooks as never))

        dropSessionChat(sessionId)

        // `ai` re-evaluates this right after `onFinish`, and a `true` here starts a NEW request.
        expect(chat.init.sendAutomaticallyWhen({messages: []})).toBe(false)
        expect(mountHooks.sendAutomaticallyWhen).not.toHaveBeenCalled()
    })

    it("does not stop a chat a newer mount already claimed", () => {
        // Two panes for one session overlap during a route transition: B commits while A is still
        // tearing down. A's cleanup must not stop the instance B is now streaming through.
        const paneA = mountAndCommit("s-overlap")
        dropSessionChat("s-overlap") // the session was torn down between the two mounts
        const paneB = mountAndCommit("s-overlap")

        releaseSessionChat("s-overlap", paneA, {preserve: false})

        expect((paneB.chat as unknown as FakeChat).stop).not.toHaveBeenCalled()
        expect(peekSessionChat("s-overlap")).toBe(paneB.chat)
    })

    describe("commit-aware first claim", () => {
        it("publishes nothing during render, so an abandoned render leaves no instance behind", () => {
            render("abandoned-1", [{id: "seed-from-a-render-nobody-saw"}])

            expect(hasSessionChat("abandoned-1")).toBe(false)
            expect(peekSessionChat("abandoned-1")).toBeUndefined()
        })

        it("seeds the COMMITTED mount's initialMessages, not an abandoned render's", () => {
            // React starts a render, then throws it away — its chat is never published.
            const abandoned = render("s-race", [{id: "stale"}])
            // The mount that actually commits carries a different seed.
            const committedHooks = hooks()
            const committed = render("s-race", [{id: "fresh"}], committedHooks)

            const live = commitSessionChat("s-race", committed)

            expect(live).toBe(committed.chat)
            expect(live).not.toBe(abandoned.chat)
            const init = (committed.chat as unknown as {init: {messages: {id: string}[]}}).init
            expect(init.messages).toEqual([{id: "fresh"}])
            // And the abandoned instance never became reachable.
            expect(peekSessionChat("s-race")).toBe(committed.chat)
        })

        it("hands a losing mount the winner's chat and rebinds it to that mount's callbacks", () => {
            const winner = mountAndCommit("s-dup", [{id: "winner"}])
            const laterHooks = hooks()
            const later = render("s-dup", [{id: "later"}], laterHooks)

            const live = commitSessionChat("s-dup", later)

            // The second mount adopts the live instance rather than orphaning the first one...
            expect(live).toBe(winner.chat)
            // ...and its callbacks are what the live chat now runs.
            ;(winner.chat as unknown as FakeChat).init.onFinish({message: {id: "m1"}})
            expect(laterHooks.onFinish).toHaveBeenCalledTimes(1)
        })
    })
})
