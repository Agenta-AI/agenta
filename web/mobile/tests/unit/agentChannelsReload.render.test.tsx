// @vitest-environment jsdom
/**
 * The Publish panel's channel connections stay put while the agent roster settles: a new
 * roster resolver (every agents-list refetch hands one over) neither reads the connections
 * again nor flips them back to loading, which held the panel's rows and the connect flow's
 * setup in a loading state while the page loaded.
 */
import {act, createElement} from "react"

import type {ChannelConnections} from "@agenta/settings-ui"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {reloads} = vi.hoisted(() => ({reloads: {count: 0}}))

vi.mock("@agenta/sdk/resources", () => ({getChannelsClient: () => ({})}))
vi.mock("@/lib/env", () => ({getApiUrl: () => "http://api.test"}))

vi.mock("@agenta/settings-ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/settings-ui")>()
    return {
        ...actual,
        // Reads one Slack connection answering as agent "a1", named the way the real reload is.
        buildAgentChannelsActions: ({
            resolveAgentName,
        }: {
            resolveAgentName: (id: string) => string | null
        }) => ({
            ...actual.NOOP_ACTIONS,
            reload: async (): Promise<ChannelConnections> => {
                reloads.count++
                return {
                    slack: {
                        platform: "slack",
                        connectionId: "c1",
                        agent: {id: "a1", name: resolveAgentName("a1")},
                    } as ChannelConnections["slack"],
                    telegram: null,
                    whatsapp: null,
                }
            },
        }),
    }
})

import {useAgentChannels} from "../../src/features/agents/useAgentChannels"

type Result = ReturnType<typeof useAgentChannels>

let root: Root
let container: HTMLDivElement
let latest: Result

const Probe = ({resolveAgentName}: {resolveAgentName: (id: string) => string | null}) => {
    latest = useAgentChannels("agent-1", {resolveAgentName})
    return null
}

const render = async (resolveAgentName: (id: string) => string | null) => {
    await act(async () => {
        root.render(createElement(Probe, {resolveAgentName}))
    })
}

describe("useAgentChannels", () => {
    beforeEach(() => {
        reloads.count = 0
        container = document.createElement("div")
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
    })

    it("keeps its connections and actions when the roster resolver changes", async () => {
        await render(() => "Support bot")
        expect(reloads.count).toBe(1)
        expect(latest.loading).toBe(false)
        const actions = latest.actions

        // The agents list refetched: same roster, a new resolver.
        await render(() => "Support bot")
        await render(() => "Support bot")

        expect(reloads.count).toBe(1)
        expect(latest.loading).toBe(false)
        expect(latest.actions).toBe(actions)
    })

    it("names the answering agent from the latest roster", async () => {
        // The connections land before the roster does.
        await render(() => null)
        expect(latest.connections.slack?.agent?.name).toBeNull()

        await render((id) => (id === "a1" ? "Support bot" : null))

        expect(latest.connections.slack?.agent?.name).toBe("Support bot")
        expect(reloads.count).toBe(1)
    })
})
