// @vitest-environment jsdom
/**
 * The agent Channels view (page and right panel tab) offers API and Embed, with the same views
 * the Publish panel opens: the API panel and the embed panel for this agent and project.
 */
import {act, createElement, isValidElement, type ReactElement, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const seen = vi.hoisted(() => ({props: null as Record<string, unknown> | null}))

vi.mock("@agenta/sdk/resources", () => ({getChannelsClient: () => ({client: true})}))
vi.mock("@/lib/env", () => ({getApiUrl: () => "http://api.test/api"}))
vi.mock("next/router", () => ({useRouter: () => ({basePath: "/m"})}))
vi.mock("../../src/features/agent-layout/useAgentRow", () => ({
    useAgentRow: () => ({row: {name: "Support triage"}, resolveAgentName: () => null}),
}))
vi.mock("../../src/features/agents/useAgentChannels", () => ({
    useAgentChannels: () => ({connections: undefined, loading: false, loadError: null}),
}))
vi.mock("@agenta/settings-ui", () => ({
    AgentApiPanel: () => null,
    AgentEmbedPanel: () => null,
    agentHostFromApiUrl: (url: string) => url.replace(/\/api$/, ""),
    AgentChannelsView: (props: Record<string, unknown>) => {
        seen.props = props
        return null
    },
}))

import {AgentChannels} from "../../src/features/agent-pages/AgentChannels"

let root: Root
let container: HTMLDivElement

beforeEach(() => {
    seen.props = null
    container = document.createElement("div")
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
})

describe("AgentChannels", () => {
    it("gives the Channels view the API and Embed views of this agent", async () => {
        await act(async () => {
            root.render(
                createElement(AgentChannels, {agentId: "a1", workspaceId: "w1", projectId: "p1"}),
            )
        })
        const api = seen.props?.api as ReactElement<Record<string, unknown>>
        expect(isValidElement(api)).toBe(true)
        expect(api.props).toEqual({
            agentId: "a1",
            projectId: "p1",
            workspaceId: "w1",
            host: "http://api.test",
        })
        const embed = seen.props?.embed as (view: object) => ReactNode
        const view = {connectionId: null, onOpen: () => undefined, onBack: () => undefined}
        const element = embed(view) as ReactElement<Record<string, unknown>>
        expect(element.props).toMatchObject({
            ...view,
            projectId: "p1",
            agentId: "a1",
            agentName: "Support triage",
            client: {client: true},
        })
        const widgetUrl = element.props.widgetUrl as (id: string) => string
        expect(widgetUrl("e1")).toBe(`${window.location.origin}/m/embed/e1`)
    })
})
