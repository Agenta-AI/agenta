// @vitest-environment jsdom
//
// The widget's wait for a reply: the typing dots stay from the send until the reply shows,
// across the new conversation's list poll, read and live subscribe, and a turn that never
// starts ends the wait with an error.
import {act, createRef, useImperativeHandle, type Ref} from "react"

import type {SessionRecord} from "@agenta/entities/session"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {EmbedClient, EmbedConversation} from "@/features/embed/embedClient"
import {REPLY_FAILED_TEXT} from "@/features/embed/embedConversationModel"
import {useEmbedConversation} from "@/features/embed/useEmbedConversation"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

type Chat = ReturnType<typeof useEmbedConversation>

const record = (id: string, sender: string, text: string, sequence: number): SessionRecord =>
    ({
        id,
        session_id: "s1",
        project_id: "p",
        event_index: null,
        sender,
        session_update: "message",
        payload: {type: "message", text},
        turn_id: null,
        created_at: null,
        sequence,
    }) as SessionRecord

const conversation: EmbedConversation = {thread_id: "t1", session_id: "s1", is_active: true}

const fakeClient = () => {
    const state = {
        conversations: [] as EmbedConversation[],
        records: [] as SessionRecord[],
        unstartedTurns: 0,
        liveConnects: 0,
    }
    const client = {
        listConversations: vi.fn(async () => state.conversations),
        readConversation: vi.fn(async () => ({
            records: state.records,
            choiceTokens: [],
            unstartedTurns: state.unstartedTurns,
        })),
        connectLive: vi.fn(() => {
            state.liveConnects += 1
            return {close: vi.fn()}
        }),
        // A first message creates the conversation on the server.
        send: vi.fn(async () => {
            if (!state.conversations.length) state.conversations = [conversation]
        }),
        fileBlob: vi.fn(),
    } as unknown as EmbedClient
    return {client, state}
}

const Probe = ({
    client,
    seen,
    ref,
}: {
    client: EmbedClient
    seen: {waiting: boolean; loading: boolean}[]
    ref: Ref<Chat>
}) => {
    const chat = useEmbedConversation({
        client,
        embedId: "e",
        visitorKey: "k",
        host: {current: {}},
    })
    seen.push({waiting: chat.waitingForReply, loading: chat.loading})
    useImperativeHandle(ref, () => chat)
    return null
}

describe("the widget's wait for a reply", () => {
    let root: Root
    let container: HTMLDivElement

    beforeEach(() => {
        container = document.createElement("div")
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root.unmount())
    })

    const mount = async (client: EmbedClient) => {
        const seen: {waiting: boolean; loading: boolean}[] = []
        const chat = createRef<Chat>()
        const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <Probe client={client} seen={seen} ref={chat} />
                </QueryClientProvider>,
            )
        })
        await vi.waitFor(() => expect(chat.current?.loading).toBe(false))
        return {seen, chat}
    }

    it("keeps the dots from a first message until the reply, through poll, read and subscribe", async () => {
        const {client, state} = fakeClient()
        const {seen, chat} = await mount(client)

        // The new conversation already holds the message, but no turn event has arrived.
        state.records = [record("r1", "user", "hi", 1)]
        await act(async () => {
            await chat.current?.send("hi", [])
        })
        const afterSend = seen.length - 1
        await vi.waitFor(() => expect(state.liveConnects).toBe(1))
        expect(chat.current?.waitingForReply).toBe(true)
        // A re-read while no turn runs, before the reply shows: still waiting.
        await vi.waitFor(
            () => expect(vi.mocked(client.readConversation).mock.calls.length).toBeGreaterThan(1),
            {timeout: 3_000},
        )

        state.records = [record("r1", "user", "hi", 1), record("r2", "agent", "hello", 2)]
        await vi.waitFor(() => expect(chat.current?.waitingForReply).toBe(false), {
            timeout: 3_000,
        })

        const waiting = seen.slice(afterSend)
        const replyAt = waiting.findIndex((render) => !render.waiting)
        expect(replyAt).toBeGreaterThan(0)
        // No render between the send and the reply hid the dots or swapped in the loader.
        expect(waiting.slice(0, replyAt).every((render) => render.waiting)).toBe(true)
        expect(waiting.every((render) => !render.loading)).toBe(true)
        expect(chat.current?.messages.map((message) => message.role)).toEqual(["user", "assistant"])
        expect(chat.current?.notice).toBe(null)
    })

    it("a second message sent before the first reply keeps waiting for its own reply", async () => {
        const {client, state} = fakeClient()
        state.conversations = [conversation]
        const {chat} = await mount(client)
        const roles = () => chat.current?.messages.map((message) => message.role)

        await act(async () => {
            await chat.current?.send("first", [])
        })
        let release: () => void = vi.fn()
        vi.mocked(client.send).mockImplementationOnce(
            () => new Promise<void>((resolve) => (release = resolve)),
        )
        let second: Promise<boolean> | undefined
        act(() => {
            second = chat.current?.send("second", [])
        })
        // The first reply lands while the second request is still in flight.
        state.records = [record("r1", "user", "first", 1), record("r2", "agent", "one", 2)]
        await vi.waitFor(() => expect(roles()).toEqual(["user", "assistant", "user"]), {
            timeout: 3_000,
        })
        expect(chat.current?.waitingForReply).toBe(true)

        await act(async () => {
            release()
            await second
        })
        state.records = [
            ...state.records,
            record("r3", "user", "second", 3),
            record("r4", "agent", "two", 4),
        ]
        await vi.waitFor(() => expect(chat.current?.waitingForReply).toBe(false), {
            timeout: 3_000,
        })
        expect(roles()).toEqual(["user", "assistant", "user", "assistant"])
    })

    it("ends the wait with an error when the turn never starts", async () => {
        const {client, state} = fakeClient()
        state.conversations = [conversation]
        state.records = [record("r1", "user", "hi", 1), record("r2", "agent", "hello", 2)]
        const {chat} = await mount(client)

        await act(async () => {
            await chat.current?.send("again", [])
        })
        expect(chat.current?.waitingForReply).toBe(true)

        state.unstartedTurns = 1
        await vi.waitFor(() => expect(chat.current?.notice).toBe(REPLY_FAILED_TEXT), {
            timeout: 3_000,
        })
        expect(chat.current?.waitingForReply).toBe(false)
        // The message that got no turn does not stay on screen as if it were sent.
        expect(chat.current?.messages).toHaveLength(2)
    })
})
