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

const Probe = ({enabled}: {enabled?: boolean}) => {
    useAgentChannels("agent-1", {enabled})
    return null
}

let root: Root

beforeEach(() => {
    reload.mockClear()
    root = createRoot(document.createElement("div"))
})

afterEach(() => {
    act(() => root.unmount())
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
})
