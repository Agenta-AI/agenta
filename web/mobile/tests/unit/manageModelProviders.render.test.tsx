// @vitest-environment jsdom
/**
 * "Manage model providers" under the composer's model list: the pane's Model view only where a
 * Configuration pane takes the request; the builder chat and the agent pages get the drawer, and
 * the request is never left set there.
 */
import type {ReactNode} from "react"

import {configPaneRevealRequestAtom} from "@agenta/chat/state"
import {openAgentConfigSectionAtom} from "@agenta/shared/state"
import {act, renderHook} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {describe, expect, it, vi} from "vitest"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {BuilderChatContext} from "@/features/chat/builderChat"
import {useManageModelProviders} from "@/features/chat/useManageModelProviders"

const panel = (configuration: boolean): AgentPanelApi => ({
    content: null,
    toggle: vi.fn(async () => true),
    close: vi.fn(async () => true),
    configTab: "agent",
    setConfigTab: vi.fn(),
    wide: false,
    setWide: vi.fn(),
    phone: false,
    available: {files: true, configuration, builder: true},
})

const setup = ({api, builder = false}: {api: AgentPanelApi | null; builder?: boolean}) => {
    const store = createStore()
    const wrapper = ({children}: {children: ReactNode}) => (
        <Provider store={store}>
            <AgentPanelContext.Provider value={api}>
                <BuilderChatContext.Provider value={builder}>
                    {children}
                </BuilderChatContext.Provider>
            </AgentPanelContext.Provider>
        </Provider>
    )
    const {result} = renderHook(() => useManageModelProviders(), {wrapper})
    act(() => result.current.open())
    return {result, store}
}

describe("Manage model providers", () => {
    it("opens the pane's Model view in a session with a Configuration pane", () => {
        const {result, store} = setup({api: panel(true)})
        expect(store.get(openAgentConfigSectionAtom)).toBe("model-harness")
        expect(store.get(configPaneRevealRequestAtom)).not.toBeNull()
        expect(result.current.drawerOpen).toBe(false)
    })

    it("opens the drawer in the builder chat, and leaves the session's pane alone", () => {
        const {result, store} = setup({api: panel(true), builder: true})
        expect(result.current.drawerOpen).toBe(true)
        expect(store.get(openAgentConfigSectionAtom)).toBeNull()
        expect(store.get(configPaneRevealRequestAtom)).toBeNull()
    })

    it.each([
        ["an agent page (no Configuration pane)", panel(false)],
        ["a screen with no agent panel", null],
    ])("opens the drawer on %s, with no request left set", (_name, api) => {
        const {result, store} = setup({api})
        expect(result.current.drawerOpen).toBe(true)
        expect(store.get(openAgentConfigSectionAtom)).toBeNull()
        act(() => result.current.closeDrawer())
        expect(result.current.drawerOpen).toBe(false)
    })
})
