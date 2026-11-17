// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const reload = vi.fn(async () => ({}))

vi.mock("@/lib/env", () => ({getApiUrl: () => "http://api.test"}))
vi.mock("@agenta/sdk/resources", () => ({getChannelsClient: () => ({})}))
vi.mock("@agenta/settings-ui", () => ({
    EMPTY_CONNECTIONS: {},
    buildAgentChannelsActions: () => ({reload}),
}))
vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {projectIdAtom: atom("project-1")}
})

import {useAgentChannels} from "@/features/agents/useAgentChannels"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let latest: ReturnType<typeof useAgentChannels>

const Probe = ({enabled}: {enabled?: boolean}) => {
    latest = useAgentChannels("agent-1", {enabled})
    return null
}

let root: Root

beforeEach(() => {
    reload.mockReset()
    reload.mockImplementation(async () => ({}))
    root = createRoot(document.createElement("div"))
})

afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
})

describe("useAgentChannels", () => {
    it("reads on mount by default", async () => {
        await act(async () => root.render(<Probe />))

        expect(reload).toHaveBeenCalledTimes(1)
    })

    it("reads nothing until it is enabled, then reads once", async () => {
        await act(async () => root.render(<Probe enabled={false} />))
        expect(reload).not.toHaveBeenCalled()

        await act(async () => root.render(<Probe enabled />))
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it("asks again when the first read fails, and shows no error while it does", async () => {
        vi.useFakeTimers()
        reload.mockRejectedValueOnce(new Error("Bad Gateway"))

        await act(async () => root.render(<Probe />))
        expect(reload).toHaveBeenCalledTimes(1)
        expect(latest.loading).toBe(true)
        expect(latest.loadError).toBeNull()

        await act(async () => vi.advanceTimersByTimeAsync(1000))
        expect(reload).toHaveBeenCalledTimes(2)
        expect(latest.loading).toBe(false)
        expect(latest.loadError).toBeNull()
    })

    it("shows the error once every retry of the first read failed", async () => {
        vi.useFakeTimers()
        reload.mockRejectedValue(new Error("Bad Gateway"))

        await act(async () => root.render(<Probe />))
        await act(async () => vi.advanceTimersByTimeAsync(1000 + 2000))
        expect(latest.loadError).toBeNull()

        await act(async () => vi.advanceTimersByTimeAsync(4000))
        expect(reload).toHaveBeenCalledTimes(4)
        expect(latest.loading).toBe(false)
        expect(latest.loadError).toBe("Could not load Channels. Try again.")
    })

    it("stops retrying once another read ran", async () => {
        vi.useFakeTimers()
        reload.mockRejectedValueOnce(new Error("Bad Gateway"))

        await act(async () => root.render(<Probe />))
        await act(async () => {
            await latest.actions.reload()
        })
        await act(async () => vi.advanceTimersByTimeAsync(10_000))

        expect(reload).toHaveBeenCalledTimes(2)
        expect(latest.loadError).toBeNull()
    })

    it("stops retrying when another read succeeded while the first one was pending", async () => {
        vi.useFakeTimers()
        let failFirst!: (error: Error) => void
        reload.mockImplementationOnce(
            () => new Promise((_, reject) => (failFirst = reject)) as Promise<object>,
        )

        await act(async () => root.render(<Probe />))
        await act(async () => {
            await latest.actions.reload()
        })
        await act(async () => failFirst(new Error("Bad Gateway")))
        await act(async () => vi.advanceTimersByTimeAsync(10_000))

        expect(reload).toHaveBeenCalledTimes(2)
        expect(latest.loadError).toBeNull()
    })
})
