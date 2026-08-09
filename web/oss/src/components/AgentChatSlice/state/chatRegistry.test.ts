import {describe, expect, it, vi} from "vitest"

import {__hasSessionChat, acquireSessionChat, releaseSessionChat} from "./chatRegistry"

// Neither dependency is under test: the transport reaches the playground request pipeline, and
// `Chat` owns the SSE read. What's under test is the acquire/release policy over the instance map.
vi.mock("../assets/AgentChatTransport", () => ({AgentChatTransport: class {}}))
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
    init: {onFinish: (event: unknown) => void}
}

const hooks = () => ({
    prepareRequest: vi.fn(),
    sendAutomaticallyWhen: () => false,
    onFinish: vi.fn(),
})

const acquire = (sessionId: string) =>
    acquireSessionChat({
        sessionId,
        initialMessages: [],
        hooks: hooks() as never,
    }) as unknown as FakeChat

let seq = 0
/** A chat under a session id no other test uses, with `status` forced. */
const mount = (status = "ready") => {
    const sessionId = `s${(seq += 1)}`
    const chat = acquire(sessionId)
    chat.status = status
    return {sessionId, chat}
}

describe("session chat registry", () => {
    it("re-binds a remount to the same instance rather than reseeding it", () => {
        const {sessionId, chat} = mount()

        expect(acquire(sessionId)).toBe(chat)
    })

    it.each(["streaming", "submitted"])(
        "preserves a %s chat across a navigation, so the run is not killed",
        (status) => {
            const {sessionId, chat} = mount(status)

            releaseSessionChat(sessionId, {stillOpen: true})

            expect(chat.stop).not.toHaveBeenCalled()
            expect(__hasSessionChat(sessionId)).toBe(true)
            // Returning gets the SAME live turn back.
            expect(acquire(sessionId)).toBe(chat)
        },
    )

    it("keeps an idle chat while its tab is open, so a re-acquire never swaps the instance", () => {
        const {sessionId, chat} = mount("ready")

        // StrictMode's dev mount runs the teardown effect once before re-running its setup; a
        // route change looks the same. Handing `useChat` a FRESH instance under the same id here
        // is the bug — it keys its message subscription on the id, so it would keep listening to
        // the dropped one.
        releaseSessionChat(sessionId, {stillOpen: true})

        expect(chat.stop).not.toHaveBeenCalled()
        expect(acquire(sessionId)).toBe(chat)
    })

    it("disposes a streaming chat when its session is no longer open", () => {
        const {sessionId, chat} = mount("streaming")

        releaseSessionChat(sessionId, {stillOpen: false})

        expect(chat.stop).toHaveBeenCalledTimes(1)
        expect(__hasSessionChat(sessionId)).toBe(false)
    })

    it("still forwards a settled turn to the mount's own onFinish", () => {
        const {sessionId, chat} = mount("streaming")
        const mountHooks = hooks()
        acquireSessionChat({sessionId, initialMessages: [], hooks: mountHooks as never})

        chat.init.onFinish({message: {id: "m1"}})

        expect(mountHooks.onFinish).toHaveBeenCalledTimes(1)
    })
})
