import {afterEach, describe, expect, it, vi} from "vitest"

import {createEmbedClient, EmbedRequestError} from "../../src/features/embed/embedClient"

const KEY = "k".repeat(10) + "abcdefghijklmnopqrstuvwxyz"
const client = () =>
    createEmbedClient({apiUrl: "https://api.example.test/api", embedId: "emb_1", visitorKey: KEY})

const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), {
        status: 200,
        ...init,
        headers: {"Content-Type": "application/json", ...init.headers},
    })

afterEach(() => vi.unstubAllGlobals())

describe("createEmbedClient", () => {
    it("sends the visitor key and never the browser's cookies", async () => {
        const fetchMock = vi.fn(async () => json({status: "accepted"}, {status: 202}))
        vi.stubGlobal("fetch", fetchMock)

        await client().send({id: "r1", text: "hi"})

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe("https://api.example.test/api/channels/embed/events/emb_1/")
        expect(init.credentials).toBe("omit")
        expect(init.method).toBe("POST")
        expect(init.headers).toMatchObject({"X-Agenta-Visitor-Key": KEY})
        expect(JSON.parse(String(init.body))).toEqual({id: "r1", text: "hi"})
    })

    it("reads records and the open choice's tokens", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                json({
                    count: 1,
                    records: [
                        {
                            record_id: "r",
                            session_id: "s",
                            project_id: "p",
                            sequence: 4,
                            record_type: "message",
                            attributes: {type: "message", text: "hi"},
                        },
                    ],
                    pending_choice: {
                        choices: [
                            {label: "Approve", token: "row:approve"},
                            {label: "Deny", token: "row:deny"},
                        ],
                        posted_at: "2026-10-16T00:00:00Z",
                    },
                    unstarted_turns: 2,
                }),
            ),
        )

        const read = await client().readConversation("t1")

        expect(read.records[0]).toMatchObject({id: "r", sequence: 4, payload: {text: "hi"}})
        expect(read.choiceTokens).toEqual(["row:approve", "row:deny"])
        expect(read.unstartedTurns).toBe(2)
    })

    it("turns a refusal into an error with its detail and Retry-After", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                json({detail: "Too many requests."}, {status: 429, headers: {"Retry-After": "7"}}),
            ),
        )

        const error = await client()
            .send({id: "r1", text: "hi"})
            .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(EmbedRequestError)
        expect(error).toMatchObject({
            status: 429,
            retryAfterSeconds: 7,
            message: "Too many requests.",
        })
    })

    it("streams live messages to the handlers and reports the end once", async () => {
        const body = [
            'event: ready\ndata: {"watermark":5}\n\n',
            `data: ${JSON.stringify({
                version: 1,
                kind: "event",
                frame_or_event_id: "ev-6",
                type: "message.completed",
                session_id: "s1",
                sequence: 6,
                watermark: 6,
                execution_id: "e1",
                created_at: "2026-10-16T00:00:00Z",
                payload: {message_id: "m1"},
            })}\n\n`,
        ].join("")
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(body, {status: 200})),
        )
        const handlers = {
            onFrame: vi.fn(),
            onEvent: vi.fn(),
            onReady: vi.fn(),
            onDisconnect: vi.fn(),
        }

        client().connectLive({threadId: "t1", sessionId: "s1", after: 5}, handlers)
        await vi.waitFor(() => expect(handlers.onDisconnect).toHaveBeenCalledTimes(1))

        expect(handlers.onReady).toHaveBeenCalledWith({watermark: 5})
        expect(handlers.onEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: "message.completed", sequence: 6}),
        )
        expect(handlers.onDisconnect).toHaveBeenCalledWith({
            reason: "connection_lost",
            reconnect: true,
        })
    })

    it("does not reconnect a stream the server refused for the key", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => json({status: "error"}, {status: 401})),
        )
        const handlers = {
            onFrame: vi.fn(),
            onEvent: vi.fn(),
            onReady: vi.fn(),
            onDisconnect: vi.fn(),
        }

        client().connectLive({threadId: "t1", sessionId: "s1", after: 0}, handlers)
        await vi.waitFor(() => expect(handlers.onDisconnect).toHaveBeenCalled())

        expect(handlers.onDisconnect).toHaveBeenCalledWith({
            reason: "unauthorized",
            reconnect: false,
        })
    })

    it("reports nothing when the caller closes the stream", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => new Promise<Response>(() => undefined)),
        )
        const handlers = {
            onFrame: vi.fn(),
            onEvent: vi.fn(),
            onReady: vi.fn(),
            onDisconnect: vi.fn(),
        }

        client().connectLive({threadId: "t1", sessionId: "s1", after: 0}, handlers).close()
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(handlers.onDisconnect).not.toHaveBeenCalled()
    })
})
