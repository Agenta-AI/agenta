import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const cleanups: (() => void)[] = []
vi.mock("react", () => ({
    useRef: <T>(current: T) => ({current}),
    useEffect: (effect: () => (() => void) | void) => {
        const cleanup = effect()
        if (cleanup) cleanups.push(cleanup)
    },
}))

const {shouldCoalesceWatchEvent, useWatchEventSource} =
    await import("../../src/watch/watchEventSource")

class FakeEventSource {
    static CLOSED = 2
    static instances: FakeEventSource[] = []
    readyState = 1
    onopen: (() => void) | null = null
    onerror: (() => void) | null = null
    listeners = new Map<string, (event: MessageEvent<string>) => void>()
    constructor(readonly url: string) {
        FakeEventSource.instances.push(this)
    }
    addEventListener(name: string, listener: (event: MessageEvent<string>) => void) {
        this.listeners.set(name, listener)
    }
    emit(name: string, data = "") {
        this.listeners.get(name)?.(new MessageEvent(name, {data}))
    }
    close() {
        this.readyState = FakeEventSource.CLOSED
    }
}

/** An in-memory BroadcastChannel: delivers to every other open channel of the same name, async. */
class FakeBroadcastChannel {
    static open = new Set<FakeBroadcastChannel>()
    onmessage: ((event: MessageEvent) => void) | null = null
    constructor(readonly name: string) {
        FakeBroadcastChannel.open.add(this)
    }
    postMessage(message: unknown) {
        for (const other of FakeBroadcastChannel.open) {
            if (other === this || other.name !== this.name) continue
            const data = JSON.parse(JSON.stringify(message))
            queueMicrotask(() => other.onmessage?.({data} as MessageEvent))
        }
    }
    close() {
        FakeBroadcastChannel.open.delete(this)
    }
}

const useTab = () => {
    const calls: string[] = []
    useWatchEventSource({
        url: "http://api.test/sessions/watch",
        on: {
            ready: () => calls.push("ready"),
            "workflow-changed": (event) => calls.push(`workflow-changed:${event.data}`),
        },
        refreshSession: async () => undefined,
        shareAcrossTabs: true,
    })
    return calls
}

describe("watch event coalescing", () => {
    it("does not delay interaction resolution behind the shared refetch window", () => {
        expect(shouldCoalesceWatchEvent("interaction")).toBe(false)
        expect(shouldCoalesceWatchEvent("record")).toBe(true)
    })
})

describe("useWatchEventSource shared across tabs", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        FakeEventSource.instances = []
        FakeBroadcastChannel.open.clear()
        vi.stubGlobal("window", globalThis)
        vi.stubGlobal("EventSource", FakeEventSource)
        vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel)
        vi.stubGlobal("document", {
            visibilityState: "visible",
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        })
    })
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup()
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it("a lone tab hears only its own stream's ready", async () => {
        const calls = useTab()
        await vi.advanceTimersByTimeAsync(1_000)
        expect(FakeEventSource.instances).toHaveLength(1)
        FakeEventSource.instances[0].emit("ready")
        await vi.advanceTimersByTimeAsync(10_000)

        expect(calls).toEqual(["ready"])
    })

    it("a follower raises one ready for itself, since it holds no stream", async () => {
        useTab()
        await vi.advanceTimersByTimeAsync(1_000)
        FakeEventSource.instances[0].emit("ready")
        const follower = useTab()
        await vi.advanceTimersByTimeAsync(10_000)

        expect(FakeEventSource.instances).toHaveLength(1)
        expect(follower).toEqual(["ready"])
    })

    it("a burst naming different workflows hands over no id, so none is dropped", async () => {
        const calls = useTab()
        await vi.advanceTimersByTimeAsync(1_000)
        const stream = FakeEventSource.instances[0]
        stream.emit("ready")
        stream.emit("workflow-changed", '{"id":"A"}')
        stream.emit("workflow-changed", '{"id":"B"}')
        stream.emit("workflow-changed", '{"id":"B"}')
        await vi.advanceTimersByTimeAsync(10_000)

        expect(calls).toEqual(["ready", "workflow-changed:"])
    })
})
