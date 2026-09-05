import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/shared/api", () => ({
    getAgentaApiUrl: () => "https://api.example.test",
}))

import {connectSessionLiveEvents} from "../../../src/transport/sessionLiveEvents"

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

    it("logs schema-invalid frames and does not deliver them", () => {
        const onFrame = vi.fn()
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
        connectSessionLiveEvents({
            sessionId: "session-1",
            onFrame,
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
