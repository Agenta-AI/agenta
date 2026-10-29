import {act, renderHook} from "@testing-library/react"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {useSessionChat} from "../../../src/hooks/useSessionChat"
import {
    __resetSessionChatsForTest,
    peekSessionChat,
    type SessionChatHooks,
} from "../../../src/state/sessionChats"

vi.mock("../../../src/transport/AgentChatTransport", () => ({
    AgentChatTransport: class {
        constructor(
            public init: {
                prepareSendMessagesRequest: (args: unknown) => Promise<unknown>
            },
        ) {}
    },
}))

vi.mock("@ai-sdk/react", () => ({
    Chat: class {
        status = "ready"
        stop = vi.fn().mockResolvedValue(undefined)
        constructor(
            public init: {
                transport: {
                    init: {
                        prepareSendMessagesRequest: (args: unknown) => Promise<unknown>
                    }
                }
                onFinish: (event: unknown) => void
                onData: (part: unknown) => void
            },
        ) {}
    },
}))

const hooks = (label: string): SessionChatHooks => ({
    prepareRequest: vi.fn().mockResolvedValue({label}),
    sendAutomaticallyWhen: vi.fn(() => false),
    onFinish: vi.fn(),
    onError: vi.fn(),
    onData: vi.fn(),
})

interface FakeChat {
    init: {
        transport: {
            init: {
                prepareSendMessagesRequest: (args: unknown) => Promise<unknown>
            }
        }
        onFinish: (event: unknown) => void
        onData: (part: unknown) => void
    }
}

beforeEach(() => {
    __resetSessionChatsForTest()
})

describe("useSessionChat", () => {
    it("keeps the chat instance while rebinding every callback to the latest render", async () => {
        const initialHooks = hooks("ephemeral")
        const currentHooks = hooks("committed")
        const view = renderHook(
            ({sessionHooks}) =>
                useSessionChat({
                    sessionId: "session-1",
                    initialMessages: [],
                    hooks: sessionHooks,
                    shouldPreserve: () => true,
                }),
            {initialProps: {sessionHooks: initialHooks}},
        )
        const chat = peekSessionChat("session-1") as unknown as FakeChat

        view.rerender({sessionHooks: currentHooks})

        expect(peekSessionChat("session-1")).toBe(chat)
        await act(async () => {
            await chat.init.transport.init.prepareSendMessagesRequest({messages: []})
            chat.init.onData({type: "data-status"})
            chat.init.onFinish({message: {id: "message-1"}})
        })
        expect(currentHooks.prepareRequest).toHaveBeenCalledOnce()
        expect(currentHooks.onData).toHaveBeenCalledOnce()
        expect(currentHooks.onFinish).toHaveBeenCalledOnce()
        expect(initialHooks.prepareRequest).not.toHaveBeenCalled()
        expect(initialHooks.onData).not.toHaveBeenCalled()
        expect(initialHooks.onFinish).not.toHaveBeenCalled()
    })
})
