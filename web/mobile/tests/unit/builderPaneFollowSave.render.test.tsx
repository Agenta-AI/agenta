// @vitest-environment jsdom
/**
 * Release QA bug 4: the builder page pane must show a builder save even when it mounts after the
 * save's result arrived (the save opened the tab, or the tab opened while the builder saved).
 */
import {createElement, type ReactNode} from "react"

import {act, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

const pin = vi.hoisted(() => vi.fn())

vi.mock("@/features/agent-pages/useConfigurationRevision", () => ({
    useConfigurationRevision: () => ({revisionId: "rev-0", pin, failed: false, retry: vi.fn()}),
}))
vi.mock("@/features/chat/ConfigPane", () => ({ConfigPane: () => null}))
vi.mock("@/features/chat/DrillInBridgeProvider", () => ({
    DrillInBridgeProvider: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/chat/useTriggerTestRun", () => ({useTriggerTestRun: () => undefined}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermissionState: () => ({pending: false, allowed: true}),
}))
vi.mock("@/features/agent-pages/PageViewStackGuard", () => ({PageViewStackGuard: () => null}))
vi.mock("@/features/agent-layout/AccessTab", () => ({AccessTab: () => null}))
vi.mock("@/features/agent-layout/AutomationsTab", () => ({AutomationsTab: () => null}))
vi.mock("@/features/agent-layout/ChannelsTab", () => ({ChannelsTab: () => null}))
vi.mock("@/features/builder-page/PaneSessions", () => ({
    PaneSessions: () => null,
    usePaneSessionPick: () => ({query: {data: undefined}}),
}))
vi.mock("@/features/builder-page/PaneSessionSwitcher", () => ({PaneSessionSwitcher: () => null}))
vi.mock("@agenta/entity-ui/drive", () => ({
    DriveSessionProvider: ({children}: {children: ReactNode}) => children,
    SessionFilesPane: () => null,
    sessionFilesPaneOpenAtomFamily: () => ({}),
}))
vi.mock("@agenta/ui/view-stack", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/ui/view-stack")>()),
    DrawerViewChrome: () => null,
    ViewStackHost: ({children}: {children: ReactNode}) => children,
    useViewStack: () => ({dirty: false}),
}))

import {AgentPane} from "@/features/builder-page/AgentPane"

const pane = (save: {toolCallId: string; revisionId: string} | null) =>
    createElement(AgentPane, {
        agentId: "agent-a",
        builderSaveToolCallId: save?.toolCallId ?? null,
        builderSaveRevisionId: save?.revisionId ?? null,
        guardRef: {current: null},
        builderSessionId: "chat-1",
        workspaceId: "w",
        projectId: "p",
    })

afterEach(() => pin.mockClear())

describe("AgentPane follows a builder save", () => {
    it("shows a save that arrived before the pane mounted", () => {
        render(pane({toolCallId: "c1", revisionId: "rev-1"}))
        expect(pin).toHaveBeenCalledWith("rev-1")
    })

    it("shows a save that arrives while the pane is open, once", () => {
        const view = render(pane(null))
        expect(pin).not.toHaveBeenCalled()
        act(() => view.rerender(pane({toolCallId: "c1", revisionId: "rev-1"})))
        act(() => view.rerender(pane({toolCallId: "c1", revisionId: "rev-1"})))
        expect(pin).toHaveBeenCalledTimes(1)
        expect(pin).toHaveBeenCalledWith("rev-1")
    })
})
