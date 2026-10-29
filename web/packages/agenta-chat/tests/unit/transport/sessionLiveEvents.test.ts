import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/shared/api", () => ({
    getAgentaApiUrl: () => "https://api.example.test",
}))

import {
    connectSessionLiveEvents,
    dispatchSessionLiveMessage,
    sessionLiveEventsUrl,
} from "../../../src/transport/sessionLiveEvents"

class FakeEventSource {
    static latest: FakeEventSource | undefined

    onmessage: ((event: MessageEvent<string>) => void) | null = null
    onerror: (() => void) | null = null
    readonly listeners = new Map<string, EventListener>()

    constructor(
        readonly url: string,
        readonly options: EventSourceInit,
    ) {
        FakeEventSource.latest = this
    }

    addEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, listener)
    }

    close(): void {}
}

describe("connectSessionLiveEvents", () => {
    beforeEach(() => {
        vi.stubGlobal("EventSource", FakeEventSource)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        FakeEventSource.latest = undefined
    })

    it("opens the stream for the session's project", () => {
        connectSessionLiveEvents({
            sessionId: "session-1",
            projectId: "project-1",
            after: 3,
            onFrame: vi.fn(),
            onEvent: vi.fn(),
            onReady: vi.fn(),
            onDisconnect: vi.fn(),
        })

        expect(FakeEventSource.latest?.url).toBe(
            "https://api.example.test/sessions/session-1/events?after=3&project_id=project-1",
        )
        expect(FakeEventSource.latest?.options).toEqual({withCredentials: true})
    })

    it("logs schema-invalid frames and does not deliver them", () => {
        const onFrame = vi.fn()
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
        connectSessionLiveEvents({
            sessionId: "session-1",
            after: 0,
            onFrame,
            onEvent: vi.fn(),
            onReady: vi.fn(),
            onDisconnect: vi.fn(),
        })

        FakeEventSource.latest?.onmessage?.(
            new MessageEvent("message", {data: JSON.stringify({kind: "frame"})}),
        )

        expect(onFrame).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalledWith(
            "[sessionLiveEvents] Validation failed:",
            expect.any(Object),
        )
    })
})

describe("sessionLiveEventsUrl", () => {
    it("reconnects after the snapshot's durable sequence watermark", () => {
        expect(sessionLiveEventsUrl("session/one", 37)).toMatch(
            /\/sessions\/session%2Fone\/events\?after=37$/,
        )
    })

    it("never sends a negative replay cursor", () => {
        expect(sessionLiveEventsUrl("session-1", -5)).toMatch(/\?after=0$/)
    })

    it("carries the session's project so the API does not use the default project", () => {
        expect(sessionLiveEventsUrl("session-1", 4, "project/a b")).toBe(
            "https://api.example.test/sessions/session-1/events?after=4&project_id=project%2Fa%20b",
        )
    })

    it("leaves project_id out when the project is not known", () => {
        expect(sessionLiveEventsUrl("session-1", 4)).toBe(
            "https://api.example.test/sessions/session-1/events?after=4",
        )
        expect(sessionLiveEventsUrl("session-1", 4, null)).toBe(
            "https://api.example.test/sessions/session-1/events?after=4",
        )
        expect(sessionLiveEventsUrl("session-1", 4, "")).toBe(
            "https://api.example.test/sessions/session-1/events?after=4",
        )
    })
})

describe("dispatchSessionLiveMessage", () => {
    const handlers = () => ({
        onFrame: vi.fn(),
        onEvent: vi.fn(),
        onReady: vi.fn(),
        onDisconnect: vi.fn(),
    })

    it("reads the readiness watermark, keeping the cursor when it is malformed", () => {
        const h = handlers()
        dispatchSessionLiveMessage(
            {event: "ready", data: '{"watermark":9}'},
            {sessionId: "s", after: 3, ...h},
        )
        dispatchSessionLiveMessage({event: "ready", data: "{"}, {sessionId: "s", after: 3, ...h})
        expect(h.onReady.mock.calls).toEqual([[{watermark: 9}], [{watermark: 3}]])
    })

    it("asks the caller to close only when the relay says not to reconnect", () => {
        const h = handlers()
        expect(
            dispatchSessionLiveMessage(
                {event: "relay-close", data: '{"reason":"revoked","reconnect":false}'},
                {sessionId: "s", after: 0, ...h},
            ),
        ).toBe(false)
        expect(
            dispatchSessionLiveMessage(
                {event: "relay-close", data: ""},
                {sessionId: "s", after: 0, ...h},
            ),
        ).toBe(true)
        expect(h.onDisconnect.mock.calls).toEqual([
            [{reason: "revoked", reconnect: false}],
            [{reason: "relay_closed", reconnect: true}],
        ])
    })

    it("delivers only this session's events and ignores unknown event names", () => {
        const h = handlers()
        const event = {
            version: 1,
            kind: "event",
            session_id: "s",
            execution_id: "e",
            frame_or_event_id: "x",
            sequence: 4,
            watermark: 4,
            type: "message.completed",
            payload: {},
            created_at: "2026-10-16T00:00:00Z",
        }
        dispatchSessionLiveMessage(
            {event: "message", data: JSON.stringify(event)},
            {sessionId: "s", after: 0, ...h},
        )
        dispatchSessionLiveMessage(
            {event: "message", data: JSON.stringify({...event, session_id: "other"})},
            {sessionId: "s", after: 0, ...h},
        )
        dispatchSessionLiveMessage({event: "ping", data: "{}"}, {sessionId: "s", after: 0, ...h})
        expect(h.onEvent).toHaveBeenCalledTimes(1)
        expect(h.onFrame).not.toHaveBeenCalled()
    })
})
