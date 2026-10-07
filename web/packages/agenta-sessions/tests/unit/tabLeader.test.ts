import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    BEAT_MS,
    JOIN_WAIT_MS,
    LEADER_TIMEOUT_MS,
    joinTabLeadership,
    type TabChannel,
} from "../../src/watch/tabLeader"

/** An in-memory BroadcastChannel: delivers to every other open channel of the same bus, async. */
const createBus = () => {
    const open = new Set<TabChannel>()
    const channels: TabChannel[] = []
    const create = (): TabChannel => {
        const channel: TabChannel = {
            onmessage: null,
            postMessage: (message) => {
                if (!open.has(channel)) return
                for (const other of open) {
                    if (other === channel) continue
                    // Structured clone, as the real channel does.
                    const data = JSON.parse(JSON.stringify(message))
                    queueMicrotask(() => other.onmessage?.({data} as MessageEvent))
                }
            },
            close: () => {
                open.delete(channel)
            },
        }
        open.add(channel)
        channels.push(channel)
        return channel
    }
    return {create, channels}
}

const joinTab = (bus: ReturnType<typeof createBus>) => {
    const tab = {leading: false, relayed: [] as unknown[], leads: 0}
    const membership = joinTabLeadership({
        channelName: "agenta-watch:test",
        createChannel: bus.create,
        onLeadChange: (leading) => {
            tab.leading = leading
            if (leading) tab.leads += 1
        },
        onRelay: (payload) => tab.relayed.push(payload),
    })
    if (!membership) throw new Error("expected a channel")
    return {...membership, tab}
}

describe("joinTabLeadership", () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it("lets exactly one of several tabs hold the stream", async () => {
        const bus = createBus()
        const a = joinTab(bus)
        await vi.advanceTimersByTimeAsync(JOIN_WAIT_MS + 200)
        const b = joinTab(bus)
        const c = joinTab(bus)
        await vi.advanceTimersByTimeAsync(LEADER_TIMEOUT_MS * 3)

        expect([a.tab.leading, b.tab.leading, c.tab.leading]).toEqual([true, false, false])
        expect(b.tab.leads + c.tab.leads).toBe(0)
    })

    it("relays the leader's events to every other tab and not back to itself", async () => {
        const bus = createBus()
        const a = joinTab(bus)
        await vi.advanceTimersByTimeAsync(JOIN_WAIT_MS + 200)
        const b = joinTab(bus)
        await vi.advanceTimersByTimeAsync(BEAT_MS)

        a.relay({name: "session-changed", data: "{}"})
        b.relay({name: "ignored", data: "follower cannot relay"})
        await vi.advanceTimersByTimeAsync(0)

        expect(b.tab.relayed).toEqual([{name: "session-changed", data: "{}"}])
        expect(a.tab.relayed).toEqual([])
    })

    it("hands the stream to another tab as soon as the leader leaves", async () => {
        const bus = createBus()
        const a = joinTab(bus)
        await vi.advanceTimersByTimeAsync(JOIN_WAIT_MS + 200)
        const b = joinTab(bus)
        await vi.advanceTimersByTimeAsync(BEAT_MS * 2)

        a.leave()
        expect(a.tab.leading).toBe(false)
        await vi.advanceTimersByTimeAsync(JOIN_WAIT_MS + 200)

        expect(b.tab.leading).toBe(true)
    })

    it("takes over when the leader goes silent without resigning", async () => {
        const bus = createBus()
        const a = joinTab(bus)
        await vi.advanceTimersByTimeAsync(JOIN_WAIT_MS + 200)
        const b = joinTab(bus)
        await vi.advanceTimersByTimeAsync(BEAT_MS * 2)
        expect(b.tab.leading).toBe(false)

        // A crashed or frozen tab: its channel goes quiet and no resign is ever sent.
        bus.channels[0].close()
        await vi.advanceTimersByTimeAsync(LEADER_TIMEOUT_MS + 200)

        expect(a.tab.leading).toBe(true)
        expect(b.tab.leading).toBe(true)
    })

    it("resolves two leaders to the tab that joined first", async () => {
        const bus = createBus()
        // Both join inside the same instant, so both time out and lead.
        const a = joinTab(bus)
        const b = joinTab(bus)
        await vi.advanceTimersByTimeAsync(JOIN_WAIT_MS + BEAT_MS * 2)

        expect([a.tab.leading, b.tab.leading].filter(Boolean)).toHaveLength(1)
    })

    it("falls back to the caller's own stream without BroadcastChannel", () => {
        expect(
            joinTabLeadership({
                channelName: "x",
                createChannel: () => null,
                onLeadChange: () => undefined,
                onRelay: () => undefined,
            }),
        ).toBeNull()
    })
})
