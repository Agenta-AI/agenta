// @vitest-environment jsdom
/**
 * The panel's Configuration on a phone (M07): three tabs (no Channels), the version status at the
 * end of the tab row pinned to the session on the Agent tab only, and a tab switch that goes back
 * to the rows. On a wide window the status is in the Agent tab's footer (S02).
 */
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"

const state = vi.hoisted(() => ({statusProps: [] as Record<string, unknown>[]}))

vi.mock("@/features/chat/ConfigPane", () => ({ConfigPane: () => <div data-testid="agent-tab" />}))
vi.mock("@/features/agent-layout/AutomationsTab", () => ({
    AutomationsTab: () => <div data-testid="automations-tab" />,
}))
vi.mock("@/features/agent-layout/ChannelsTab", () => ({
    ChannelsTab: () => <div data-testid="channels-tab" />,
}))
vi.mock("@/features/agent-layout/AccessTab", () => ({AccessTab: () => null}))
vi.mock("@agenta/playground-ui/agent-page-header", () => ({
    AgentRevisionStatus: (props: Record<string, unknown>) => {
        state.statusProps.push(props)
        return <span data-testid="revision-status" />
    },
}))

const {ConfigurationRoot} = await import("@/features/agent-layout/ConfigurationRoot")

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    state.statusProps = []
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const panel = (over: Partial<AgentPanelApi>): AgentPanelApi => ({
    content: "configuration",
    toggle: vi.fn(async () => true),
    close: vi.fn(async () => true),
    configTab: "agent",
    setConfigTab: vi.fn(),
    wide: false,
    setWide: vi.fn(),
    phone: true,
    available: {configuration: true, files: true, builder: true},
    ...over,
})

const mount = (api: AgentPanelApi, onCloseSection = vi.fn()) =>
    act(async () =>
        root.render(
            <Provider store={createStore()}>
                <AgentPanelContext.Provider value={api}>
                    <ConfigurationRoot
                        agentId="support"
                        revisionId="rev-4"
                        sessionId="s1"
                        filesScope="scope"
                        workspaceId="w1"
                        projectId="p1"
                        phoneSection={null}
                        onCloseSection={onCloseSection}
                    />
                </AgentPanelContext.Provider>
            </Provider>,
        ),
    )

const tabs = () => [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)

describe("panel Configuration on a phone", () => {
    it("shows three tabs and the version status at the end of the tab row", async () => {
        await mount(panel({}))
        expect(tabs()).toEqual(["Agent", "Automations", "Access"])
        const status = host.querySelector('[data-testid="revision-status"]')!
        expect(status.previousElementSibling?.getAttribute("role")).toBe("tablist")
        expect(state.statusProps.at(-1)).toMatchObject({
            revisionId: "rev-4",
            historyWorkflowId: "support",
            checkKey: "s1",
            phone: true,
            backTitle: "Configuration",
        })
    })

    it("shows the Agent tab when the stored tab is Channels", async () => {
        await mount(panel({configTab: "channels"}))
        expect(host.querySelector('[data-testid="agent-tab"]')).not.toBeNull()
        expect(host.querySelector('[data-testid="channels-tab"]')).toBeNull()
    })

    it("goes back to the rows on a tab switch", async () => {
        const api = panel({})
        const onCloseSection = vi.fn()
        await mount(api, onCloseSection)
        const access = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(
            (tab) => tab.textContent === "Access",
        )!
        await act(async () => access.click())
        expect(onCloseSection).toHaveBeenCalledOnce()
        expect(api.setConfigTab).toHaveBeenCalledWith("access")
    })

    it("shows no version status on the Automations tab (M10)", async () => {
        await mount(panel({configTab: "automations"}))
        expect(host.querySelector('[data-testid="automations-tab"]')).not.toBeNull()
        expect(host.querySelector('[data-testid="revision-status"]')).toBeNull()
    })

    it("on a wide window keeps four tabs and puts History and the status in the Agent tab footer", async () => {
        await mount(panel({phone: false}))
        expect(tabs()).toEqual(["Agent", "Automations", "Channels", "Access"])
        const status = host.querySelector('[data-testid="revision-status"]')!
        // Not in the tab row: in the footer under the Agent tab's content (S02).
        expect(host.querySelector('[role="tablist"]')!.parentElement!.contains(status)).toBe(false)
        expect(host.querySelector('[role="tabpanel"]')!.contains(status)).toBe(true)
        expect(state.statusProps.at(-1)).toMatchObject({
            revisionId: "rev-4",
            historyWorkflowId: "support",
            // The footer status may draw the history drawer: it keeps the update action.
            checkKey: "s1",
            footer: true,
        })
        expect(state.statusProps.at(-1)?.onUpdate).toBeTypeOf("function")
    })

    it("on a wide window shows no footer on the Automations tab", async () => {
        await mount(panel({phone: false, configTab: "automations"}))
        expect(host.querySelector('[data-testid="revision-status"]')).toBeNull()
    })
})
